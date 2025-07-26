const asynchandler = require("../utils/asynchandler");
const User = require("../models/User.model");
const apiError = require("../utils/apiError");
const uploadOnCloudinary = require("../utils/cloudinary");
const ApiResponse = require("../utils/apiResponse");
const {
  generateOTP,
  generateOTPExpiry,
  verifyOTP,
  canResendOTP,
} = require("../utils/otpGenerator");
const { sendSignupOTP, sendSigninOTPEmail } = require("../utils/emailService");

const registerUser = asynchandler(async (req, res) => {
  const { username, email, password, fullname, name, phone, address } =
    req.body;
  console.log("Registration request:", {
    username,
    email,
    password: password ? "PROVIDED" : "MISSING",
    fullname,
    name,
    phone,
    address,
  });

  // Simple validation - exactly what frontend sends
  if (!username || !email || !password) {
    throw new apiError(400, "Please provide username, email, and password");
  }

  // Validate required fields for complete registration
  if (!name) {
    throw new apiError(400, "Name is required");
  }
  if (!phone) {
    throw new apiError(400, "Phone number is required");
  }
  if (
    !address ||
    !address.street ||
    !address.city ||
    !address.state ||
    !address.pincode
  ) {
    throw new apiError(
      400,
      "Complete address (street, city, state, pincode) is required"
    );
  }

  try {
    // Check if user already exists with this email
    const existedUser = await User.findOne({ email });
    console.log(
      "Found existing user:",
      existedUser
        ? {
            email: existedUser.email,
            username: existedUser.username,
            isEmailVerified: existedUser.isEmailVerified,
            hasRealPassword:
              existedUser.password &&
              !existedUser.password.startsWith("temp_password_"),
            hasRealUsername: !existedUser.username.startsWith("temp_"),
            isFullyRegistered:
              existedUser.isEmailVerified &&
              existedUser.password &&
              !existedUser.password.startsWith("temp_password_") &&
              !existedUser.username.startsWith("temp_"),
          }
        : "NO_USER_FOUND"
    );

    if (existedUser) {
      // Check if user is fully registered (has real password AND real username, not temp)
      const isFullyRegistered =
        existedUser.isEmailVerified &&
        existedUser.password &&
        !existedUser.password.startsWith("temp_password_") &&
        !existedUser.username.startsWith("temp_");

      if (isFullyRegistered) {
        // User is completely registered
        throw new apiError(409, "User with this email already exists");
      } else if (existedUser.isEmailVerified) {
        // Email is verified but user hasn't completed registration (still has temp username or password)

        // Check if someone else is using this username (exclude current user only)
        const usernameConflict = await User.findOne({
          username: username.toLowerCase(),
          email: { $ne: email },
          isEmailVerified: true,
          password: { $not: /^temp_password_/ },
        });

        console.log("Username conflict check:", {
          searchingFor: username.toLowerCase(),
          excludeEmail: email,
          foundConflict: !!usernameConflict,
        });

        if (usernameConflict) {
          throw new apiError(409, "Username is already taken by another user");
        }

        // Check if someone else is using this phone number
        const phoneConflict = await User.findOne({
          phone: phone,
          email: { $ne: email },
          isEmailVerified: true,
          password: { $not: /^temp_password_/ },
        });

        if (phoneConflict) {
          throw new apiError(
            409,
            "Phone number is already registered to another user"
          );
        }

        console.log("Completing registration for verified user");
        existedUser.name = name;
        existedUser.username = username.toLowerCase();
        existedUser.fullname = fullname || name;
        existedUser.phone = phone;
        existedUser.password = password; // Will be hashed by pre-save middleware
        existedUser.address = {
          street: address.street,
          city: address.city,
          state: address.state,
          pincode: address.pincode,
          geolocation: {
            lat: address.geolocation?.lat || 0.0,
            lng: address.geolocation?.lng || 0.0,
          },
        };
        existedUser.avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(fullname || name)}&background=6366f1&color=ffffff&size=200`;

        await existedUser.save();

        // Return user without password
        const updatedUser = await User.findById(existedUser._id).select(
          "-password -refresh_token"
        );

        return res
          .status(201)
          .json(
            new ApiResponse(201, "User registered successfully", updatedUser)
          );
      } else {
        // Email not verified yet
        throw new apiError(400, "Please verify your email first");
      }
    }

    // No existing user found, this shouldn't happen in normal flow
    throw new apiError(400, "Please verify your email first");
  } catch (error) {
    console.error("Registration error:", error);

    // Handle MongoDB duplicate key error
    if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      const value = error.keyValue[field];
      throw new apiError(
        409,
        `A user with this ${field} (${value}) already exists. Please choose a different ${field}.`
      );
    }

    // Re-throw other errors
    throw error;
  }
});

// Send OTP for email verification during signup
const sendEmailVerificationOTP = asynchandler(async (req, res) => {
  const { email, username } = req.body;
  console.log("Email verification request:", { email, username });

  if (!email) {
    throw new apiError(400, "Email is required");
  }

  // Check if user already exists with this email
  const existingUser = await User.findOne({ email });

  // If user exists and is already verified, they can't request new verification
  if (
    existingUser &&
    existingUser.isEmailVerified &&
    existingUser.password &&
    !existingUser.password.startsWith("temp_password_")
  ) {
    throw new apiError(409, "Email is already registered and verified");
  }

  // Check if someone else is trying to use this username (but different email)
  if (username) {
    const usernameExists = await User.findOne({
      username: username.toLowerCase(),
      email: { $ne: email },
      isEmailVerified: true,
      password: { $not: /^temp_password_/ },
    });

    if (usernameExists) {
      throw new apiError(409, "Username is already taken by another user");
    }
  }

  // If user exists but not verified, allow OTP resend (don't throw error)
  console.log(
    "Existing user found:",
    existingUser ? "Yes (not fully registered)" : "No"
  );

  // Check if we can send OTP (rate limiting)
  if (
    existingUser &&
    !canResendOTP(existingUser.emailVerificationOTPLastSent)
  ) {
    throw new apiError(
      429,
      "Please wait 30 seconds before requesting a new OTP"
    );
  }

  // Generate OTP
  const otp = generateOTP();
  const otpExpiry = generateOTPExpiry();

  try {
    // Send email
    console.log("Attempting to send OTP email to:", email);
    console.log("Email credentials check:", {
      EMAIL_USER: process.env.EMAIL_USER ? "SET" : "NOT SET",
      EMAIL_PASS: process.env.EMAIL_PASS ? "SET" : "NOT SET",
    });

    await sendSignupOTP(email, otp, username);
    console.log("Email sent successfully");

    // Save or update OTP in database
    if (existingUser) {
      console.log("Updating existing user with new OTP");
      existingUser.emailVerificationOTP = otp;
      existingUser.emailVerificationOTPExpiry = otpExpiry;
      existingUser.emailVerificationOTPLastSent = new Date();
      // Update username if provided
      if (username && username !== existingUser.username) {
        existingUser.username = username;
        existingUser.fullname = username;
      }
      await existingUser.save();
    } else {
      // Create temporary user record with guaranteed unique username
      console.log("Creating temporary user record");
      // Generate a unique temporary username to avoid conflicts
      const baseUsername = username || "user";
      const timestamp = Date.now();
      const randomSuffix = Math.random().toString(36).substr(2, 5);
      const tempUsername =
        `temp_${baseUsername}_${timestamp}_${randomSuffix}`.toLowerCase();

      await User.create({
        name: username || "Temp User",
        email,
        username: tempUsername,
        fullname: username || "Temp User",
        phone: `temp_${timestamp}`, // Temporary phone number
        password: `temp_password_${timestamp}`, // Will be updated during actual registration
        address: {
          street: "Temporary Street",
          city: "Temporary City",
          state: "Temporary State",
          pincode: "000000",
          geolocation: {
            lat: 0.0,
            lng: 0.0,
          },
        },
        emailVerificationOTP: otp,
        emailVerificationOTPExpiry: otpExpiry,
        emailVerificationOTPLastSent: new Date(),
        isEmailVerified: false,
      });
    }

    return res
      .status(200)
      .json(
        new ApiResponse(200, "OTP sent successfully to your email", { email })
      );
  } catch (error) {
    console.error("Error in sendEmailVerificationOTP:", error);
    throw new apiError(
      500,
      `Failed to send verification email: ${error.message}`
    );
  }
});

// Verify email OTP during signup
const verifyEmailOTP = asynchandler(async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    throw new apiError(400, "Email and OTP are required");
  }

  const user = await User.findOne({ email });
  if (!user) {
    throw new apiError(404, "User not found. Please request OTP first");
  }

  // Verify OTP
  const isValid = verifyOTP(
    otp,
    user.emailVerificationOTP,
    user.emailVerificationOTPExpiry
  );

  if (!isValid) {
    throw new apiError(400, "Invalid or expired OTP");
  }

  // Mark email as verified but DON'T fully register user yet
  // User will be fully registered when they submit the complete signup form
  user.isEmailVerified = true;
  user.emailVerificationOTP = undefined;
  user.emailVerificationOTPExpiry = undefined;
  user.emailVerificationOTPLastSent = undefined;
  await user.save();

  return res.status(200).json(
    new ApiResponse(
      200,
      "Email verified successfully. Please complete your registration.",
      {
        email,
        isEmailVerified: true,
      }
    )
  );
});

// Resend email verification OTP
const resendEmailVerificationOTP = asynchandler(async (req, res) => {
  const { email, username } = req.body;

  if (!email) {
    throw new apiError(400, "Email is required");
  }

  const user = await User.findOne({ email });
  if (!user) {
    throw new apiError(404, "User not found");
  }

  if (user.isEmailVerified) {
    throw new apiError(400, "Email is already verified");
  }

  // Check rate limiting
  if (!canResendOTP(user.emailVerificationOTPLastSent)) {
    throw new apiError(
      429,
      "Please wait 30 seconds before requesting a new OTP"
    );
  }

  // Generate new OTP
  const otp = generateOTP();
  const otpExpiry = generateOTPExpiry();

  try {
    // Send email
    await sendSignupOTP(email, otp, username || user.username);

    // Update OTP in database
    user.emailVerificationOTP = otp;
    user.emailVerificationOTPExpiry = otpExpiry;
    user.emailVerificationOTPLastSent = new Date();
    await user.save();

    return res
      .status(200)
      .json(new ApiResponse(200, "New OTP sent successfully", { email }));
  } catch (error) {
    throw new apiError(500, "Failed to resend verification email");
  }
});

// Send OTP for signin
const sendSigninOTP = asynchandler(async (req, res) => {
  const { email } = req.body;
  console.log("Signin OTP request for email:", email);

  if (!email) {
    throw new apiError(400, "Email is required");
  }

  // Check for duplicate users with the same email
  const allUsersWithEmail = await User.find({ email });
  console.log(
    "All users with this email:",
    allUsersWithEmail.map((u) => ({
      _id: u._id,
      username: u.username,
      password: u.password ? "[PRESENT]" : "[MISSING]",
      isEmailVerified: u.isEmailVerified,
      signinOTPLastSent: u.signinOTPLastSent,
      createdAt: u.createdAt,
    }))
  );
  // Use the user with the latest createdAt (most recent registration)
  const user = allUsersWithEmail.sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  )[0];
  if (!user) {
    console.log("No user found with email:", email);
    throw new apiError(404, "No account found with this email");
  }

  console.log("User found:", {
    email: user.email,
    isEmailVerified: user.isEmailVerified,
    hasRealPassword:
      user.password && !user.password.startsWith("temp_password_"),
    hasRealUsername: !user.username.startsWith("temp_"),
    isFullyRegistered:
      user.isEmailVerified &&
      user.password &&
      !user.password.startsWith("temp_password_") &&
      !user.username.startsWith("temp_"),
  });

  if (!user.isEmailVerified) {
    throw new apiError(400, "Please verify your email first");
  }

  // Check if user is fully registered (not just email verified)
  const isFullyRegistered =
    user.isEmailVerified &&
    user.password &&
    !user.password.startsWith("temp_password_") &&
    !user.username.startsWith("temp_");

  if (!isFullyRegistered) {
    throw new apiError(400, "Please complete your registration first");
  }

  // Check rate limiting
  if (!canResendOTP(user.signinOTPLastSent)) {
    throw new apiError(
      429,
      "Please wait 30 seconds before requesting a new OTP"
    );
  }

  // Generate OTP
  const otp = generateOTP();
  const otpExpiry = generateOTPExpiry();

  try {
    // Send email
    console.log("Sending signin OTP email to:", email);
    await sendSigninOTPEmail(email, otp, user.username);

    // Save OTP in database
    console.log("Saving OTP data:", { otp, otpExpiry, email });
    user.signinOTP = otp;
    user.signinOTPExpiry = otpExpiry;
    user.signinOTPLastSent = new Date();

    console.log("User before save:", {
      email: user.email,
      signinOTP: user.signinOTP,
      signinOTPExpiry: user.signinOTPExpiry,
      signinOTPLastSent: user.signinOTPLastSent,
    });

    const savedUser = await user.save();

    console.log("User after save:", {
      email: savedUser.email,
      signinOTP: savedUser.signinOTP,
      signinOTPExpiry: savedUser.signinOTPExpiry,
      signinOTPLastSent: savedUser.signinOTPLastSent,
    });

    console.log("Signin OTP sent and saved successfully");

    return res
      .status(200)
      .json(new ApiResponse(200, "Signin OTP sent successfully", { email }));
  } catch (error) {
    console.error("Failed to send signin OTP:", error);
    throw new apiError(500, "Failed to send signin OTP");
  }
});

// Verify signin OTP
const verifySigninOTP = asynchandler(async (req, res) => {
  const { email, otp } = req.body;
  console.log("Signin OTP verification request:", {
    email,
    otp,
    bodyData: req.body,
  });

  if (!email || !otp) {
    console.log("Missing email or OTP:", { email: !!email, otp: !!otp });
    throw new apiError(400, "Email and OTP are required");
  }

  // Find all users with this email and use the one with the latest signinOTPLastSent
  const allUsersWithEmail = await User.find({ email });
  if (!allUsersWithEmail.length) {
    console.log("User not found for email:", email);
    throw new apiError(404, "User not found");
  }
  // Use the user with the latest signinOTPLastSent (most recent OTP)
  const user = allUsersWithEmail.sort(
    (a, b) =>
      new Date(b.signinOTPLastSent || 0) - new Date(a.signinOTPLastSent || 0)
  )[0];

  console.log("User signin OTP data:", {
    email: user.email,
    storedOTP: user.signinOTP,
    otpExpiry: user.signinOTPExpiry,
    userEnteredOTP: otp,
    currentTime: new Date(),
    isExpired: user.signinOTPExpiry
      ? new Date() > new Date(user.signinOTPExpiry)
      : "NO_EXPIRY",
  });

  // Verify OTP
  const isValid = verifyOTP(otp, user.signinOTP, user.signinOTPExpiry);
  console.log("OTP verification result:", isValid);

  if (!isValid) {
    console.log("OTP verification failed");
    throw new apiError(400, "Invalid or expired OTP");
  }

  console.log("OTP verified successfully, proceeding with signin");

  // Clear signin OTP
  user.signinOTP = undefined;
  user.signinOTPExpiry = undefined;
  user.signinOTPLastSent = undefined;
  await user.save();

  // Generate tokens
  console.log("Generating access token for user:", user.email);
  const accessToken = user.generateAccessToken();
  const refreshToken = user.generateRefreshToken();
  console.log("Generated tokens:", { accessToken, refreshToken });

  // Save refresh token
  user.refresh_token = refreshToken;
  await user.save();

  // Remove sensitive data
  const { refresh_token, password, ...userResponse } = user.toObject();

  const options = {
    httpOnly: true,
    secure: true,
  };

  console.log("Signin successful for user:", user.email);

  return res
    .status(200)
    .cookie("accessToken", accessToken, options)
    .cookie("refreshToken", refreshToken, options)
    .json(
      new ApiResponse(200, "Signin successful", {
        user: userResponse,
        accessToken,
        refreshToken,
      })
    );
});

// Resend signin OTP
const resendSigninOTP = asynchandler(async (req, res) => {
  const { email } = req.body;

  if (!email) {
    throw new apiError(400, "Email is required");
  }

  // Find all users with this email and use the one with the latest createdAt (most recent registration)
  const allUsersWithEmail = await User.find({ email });
  if (!allUsersWithEmail.length) {
    throw new apiError(404, "User not found");
  }
  const user = allUsersWithEmail.sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  )[0];

  // Check rate limiting
  if (!canResendOTP(user.signinOTPLastSent)) {
    throw new apiError(
      429,
      "Please wait 30 seconds before requesting a new OTP"
    );
  }

  // Generate new OTP
  const otp = generateOTP();
  const otpExpiry = generateOTPExpiry();

  try {
    // Send email
    await sendSigninOTPEmail(email, otp, user.username);

    // Update OTP in database
    user.signinOTP = otp;
    user.signinOTPExpiry = otpExpiry;
    user.signinOTPLastSent = new Date();
    await user.save();

    return res
      .status(200)
      .json(
        new ApiResponse(200, "New signin OTP sent successfully", { email })
      );
  } catch (error) {
    throw new apiError(500, "Failed to resend signin OTP");
  }
});

module.exports = {
  registerUser,
  sendEmailVerificationOTP,
  verifyEmailOTP,
  resendEmailVerificationOTP,
  sendSigninOTP,
  verifySigninOTP,
  resendSigninOTP,
};
