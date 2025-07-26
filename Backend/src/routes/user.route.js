const router = require("express").Router();
const {
  registerUser,
  sendEmailVerificationOTP,
  verifyEmailOTP,
  resendEmailVerificationOTP,
  sendSigninOTP,
  verifySigninOTP,
  resendSigninOTP,
} = require("../controllers/user.controller");
const upload = require("../middlewares/multer.middleware");
const { loginUser, logoutUser } = require("../controllers/login.controller");
const verifyJWT = require("../middlewares/auth.middleware");
const { refreshToken } = require("../controllers/refreshToken.controller");
const {
  changePassword,
  getCurrentUser,
  updateAccountDetails,
  changeAvatar,
  changeCoverImages,
} = require("../controllers/changeUserProfile");
// const {signup} = require('../controllers/authController');

// router.post('/register',upload.fields
// (
//     [
//         {
//             name:'avatar',
//             maxCount:1
//         },
//         {
//             name:'cover images',
//             maxCount:5
//         }
//     ]
// ), registerUser);    // Route to register a user
// excluded multer and use fileupload in app.js

router.post("/register", registerUser); // Route to register a user
router.post("/login", loginUser); // Route to login a user
router.post("/logout", verifyJWT, logoutUser); // Route to logout a user
router.post("/refresh-token", refreshToken); // Route to refresh the access token
router.patch("/change-password", verifyJWT, changePassword); // Route to change the password
router.get("/get-user", verifyJWT, getCurrentUser); // Route to get the current user
router.patch("/update-account", verifyJWT, updateAccountDetails); // Route to update the account details
router.patch(
  "/change-avatar",
  verifyJWT,
  upload.single("avatar"),
  changeAvatar
); // Route to change the avatar using multer
router.patch(
  "/change-cover-images",
  verifyJWT,
  upload.array("cover images", 5),
  changeCoverImages
); // Route to change the cover images using multer
// router.get('/watch-history', verifyJWT, getWatchhistory);    // Route to get the watch history - TODO: Implement this function
// router.get('/profile/:username',verifyJWT, AddProfileDetails);    // Route to get profile details - TODO: Implement this function

// OTP Routes for Email Verification (Signup)
router.post("/send-verification-otp", sendEmailVerificationOTP); // Send OTP for email verification
router.post("/verify-email-otp", verifyEmailOTP); // Verify email OTP
router.post("/resend-verification-otp", resendEmailVerificationOTP); // Resend email verification OTP

// OTP Routes for Signin
router.post("/send-signin-otp", sendSigninOTP); // Send OTP for signin
router.post("/verify-signin-otp", verifySigninOTP); // Verify signin OTP
router.post("/resend-signin-otp", resendSigninOTP); // Resend signin OTP

// router.post("/signup", signup);
// router.route('/register').post(registerUser);    // Route to register a user (used chaining method syntax)

module.exports = router; // Export the router
