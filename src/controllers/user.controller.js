import { asyncHandler } from "../utils/asyncHandler.js";
import User from "../models/user.model.js";
import { checkEmptyOrNull } from "../utils/validations.js";
import { ApiError } from "../utils/ApiError.js";
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import jwt from "jsonwebtoken";

const genrateAccessTokenAndRefreashToeken = async (userId) => {
    try {
        const user = await User.findById(userId);
        const refreshToken = await user.genrateRefreshToken();
        const accessToken = await user.genrateAccessToken();
        user.refreshToken = refreshToken;
        await user.save({ validateBeforeSave: false });
        return { accessToken, refreshToken };
    } catch (error) {
        throw new ApiError(500, "something went wrong ");
    }
};

export const registerUser = asyncHandler(async (req, res) => {
    //Get User Details form req {username , email , password , ,fullName , avatar , coverImage :optional}
    const { fullName, username, email, password } = req.body;

    //Vaidation of all details  -- not empty
    if (checkEmptyOrNull([fullName, username, email, password])) {
        throw new ApiError(400, "All fields Are required");
    }

    //Check if User already exits
    const existedUser = await User.findOne({
        $or: [{ username }, { email }],
    });

    if (existedUser) {
        throw new ApiError(409, "User already exists");
    }

    //Check for coverImage:optional and avatar:required
    console.log(req?.files.avatar[0].path);
    const avatarImage = await req.files?.avatar?.[0]?.path;
    if (!avatarImage) {
        throw new ApiError(400, "Avatar is Required");
    }
    let coverImage;
    if (
        req.files &&
        Array.isArray(req.files.coverImage) &&
        req.files.coverImage.length > 0
    ) {
        coverImage = await req.files?.coverImage[0]?.path;
    }

    //upload to cloudinary , check avatar uploaded
    const uploadedAvatar = await uploadOnCloudinary(avatarImage);
    const uploadedCoverImage = await uploadOnCloudinary(coverImage);

    if (!uploadedAvatar) {
        throw new ApiError(500, "Avatar is Required");
    }

    //create User object
    const userObject = {
        username: username.toLowerCase(),
        email,
        password,
        fullName,
        avatar: uploadedAvatar.url,
        coverImage: uploadedCoverImage?.url || "",
    };

    const createdUser = await User.create(userObject);

    //check for user Creation
    //remove password and refreshToken form res
    const checkUser = await User.findById(createdUser._id).select(
        "-password -refreshToken"
    );
    if (!checkUser) {
        throw new ApiError(
            500,
            "Internal Server Error while registering the User"
        );
    }

    //return res
    return res
        .status(201)
        .json(new ApiResponse(200, "user created ", checkUser));
});

export const loginUser = asyncHandler(async (req, res) => {
    //Get data form req Body

    const { username, email, password } = req.body;
    console.log(username, email);
    //Validate the data see if its empty  || null  || undefined
    if (!username && !email) {
        throw new ApiError(400, "username oe email is required");
    }
    if (!password) {
        throw new ApiError(400, "password is required");
    }
    //check if User exists via {username || email }
    const user = await User.findOne({
        $or: [{ username }, { email }],
    });

    if (!user) {
        throw new ApiError(404, "user not Found");
    }

    //check if  password is Right via  method
    const passwordCheck = await user.passwordCheck(password);
    if (!passwordCheck) {
        throw new ApiError(401, "password incorrect");
    }
    //make jsonweb token and refresh token
    //store refreshToken to Database
    const { accessToken, refreshToken } =
        await genrateAccessTokenAndRefreashToeken(user._id);
    const loggendinUser = await User.findById(user._id).select(
        "-password -refreshToken"
    );
    //set cookies to res
    //send response back
    const options = { httpOnly: true, secure: true };

    return res
        .status(200)
        .cookie("accessToken", accessToken, options)
        .cookie("refreshToken", refreshToken, options)
        .json(
            new ApiResponse(200, "login sucess", {
                user: loggendinUser,
                accessToken,
                refreshToken,
            })
        );
});

export const logOutUser = asyncHandler(async (req, res) => {
    const userId = req?.user._id;
    await User.findByIdAndUpdate(
        userId,
        {
            $set: {
                refreshToken: undefined,
            },
        },
        { new: true }
    );
    const options = { httpOnly: true, secure: true };
    return res
        .status(200)
        .clearCookie("accessToken", options)
        .clearCookie("refreshToken", options)
        .json(new ApiResponse(200, "user Logged Out ", {}));
});

export const refreshAccessToken = asyncHandler(async (req, res) => {
    //Get refreshToken form req (added a Middleware for Jwt verificaton)
    const getRefreshToken = req.cookies.refreshToken;

    //Ceck if there is refresh token
    if (!getRefreshToken) {
        throw new ApiError(401, "Unauthorized  ");
    }

    //Decode The refresh Token
    try {
        const decodedRefreshToken = jwt.verify(
            getRefreshToken,
            process.env.REFRESH_SECRET
        );

        //check is refreshToken is valid
        if (!decodedRefreshToken) {
            throw new ApiError(401, "Unauthorized token ");
        }

        //get User form Database
        const user = await User.findById(decodedRefreshToken?._id);

        if (!user) {
            throw new ApiError(401, "Unauthorized token ");
        }

        //match both token( server === incomingRefreshToken)
        if (getRefreshToken !== user.refreshToken) {
            throw new ApiError(401, " token is expired or used  ");
        }
        const options = { httpOnly: true, secure: true };
        const { accessToken, newRefeshToken } =
            await genrateAccessTokenAndRefreashToeken(user._id);

        //send the req with cookies
        res.status(200)
            .cookie("accessToken", accessToken, options)
            .cookie("refreshToken", newRefeshToken, options)
            .json(new ApiResponse(201, "new refresh Token sucess"), {});
    } catch (error) {
        throw new ApiError(500, error?.message || "something went wrong");
    }
});

export const changeUserCurrentPassword = asyncHandler(async (req, res) => {
    //take old and new password form req body and also check if password is there
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword && !newPassword) {
        throw new ApiError(400, "All fields are required");
    }
    //get User form database
    const userId = req?.user._id;
    const user = User.findById(req?.user._id);
    if (!user) {
        throw new ApiError(401, "User not Found");
    }
    //check if password match  with user provided password
    const passCheck = await user.passwordCheck(oldPassword);
    if (!passCheck) {
        throw new ApiError(400, "Wrong Old Password");
    }
    // change the old password with new one
    user.password = newPassword;
    await user.save({ validateBeforeSave: false });

    //send the response

    return res
        .status(200)
        .json(new ApiResponse(200, "Password changed successfully", {}));
});
