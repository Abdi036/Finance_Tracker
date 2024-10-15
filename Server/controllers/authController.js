const User = require("../models/userModel");
const AppError = require("../utils/appError");
const catchAsync = require("../utils/catchAsync");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const sendEmail = require("../utils/email");

// Token generation function
function generateToken(id) {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "7d" });
}

exports.signup = catchAsync(async (req, res, next) => {
  // Create new user
  const newUser = await User.create({
    name: req.body.name,
    email: req.body.email,
    password: req.body.password,
    confirmPassword: req.body.confirmPassword,
  });

  // Generate token for the user
  const token = generateToken(newUser._id);

  // Send response with user data and token
  res.status(201).json({
    status: "success",
    token,
    data: {
      user: newUser,
    },
  });
});

exports.login = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;

  // Check if both password and email exist
  if (!email || !password) {
    return next(new AppError("All fields are required", 400));
  }

  // Check if user exists and password is correct
  const user = await User.findOne({ email }).select("+password");

  if (!user || !(await user.correctPassword(password, user.password))) {
    return next(new AppError("Invalid email or password", 401));
  }

  // Generate token if everything is okay
  const token = generateToken(user._id);

  // Send token to the client
  res.status(200).json({
    status: "success",
    token,
  });
});

// forgotPassword
exports.forgotPassword = catchAsync(async (req, res, next) => {
  const user = await User.findOne({ email: req.body.email });

  if (!user) {
    return next(new AppError("User not found!", 404));
  }

  const resetToken = user.createPasswordResetToken();
  await user.save({ validateBeforeSave: false });

  const resetURL = `${req.protocol}://localhost:5173/resetPassword/${resetToken}`;

  const textMessage = `If you forgot your password, click the link below to reset it: ${resetURL}.\nIf you didn't request this, please ignore this email.`;

  const htmlMessage = `
        <p>If you forgot your password, click the link below to reset it:</p>
        <a href="${resetURL}">Reset Password</a>
        <p>If you didn't request this, please ignore this email.</p>
      `;

  try {
    await sendEmail({
      email: user.email,
      subject: "Your password reset token (valid for 10 minutes)",
      text: textMessage,
      html: htmlMessage,
    });

    res.status(200).json({
      status: "success",
      message: "Token sent to email",
    });
  } catch (err) {
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;

    await user.save({ validateBeforeSave: false });

    return next(
      new AppError(
        "There was an error sending the email. Try again later!",
        500
      )
    );
  }
});

exports.resetPassword = catchAsync(async (req, res, next) => {
  // Hash the token from the request params
  const hashedToken = crypto
    .createHash("sha256")
    .update(req.params.token)
    .digest("hex");

  console.log("Received token:", req.params.token);
  console.log("Hashed token:", hashedToken);

  // Find the user with the hashed token and check if the token is still valid
  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: Date.now() }, // Check if the token is still valid
  });

  if (!user) {
    return next(new AppError("Token is invalid or has expired", 400));
  }

  // Check if the passwords match
  if (req.body.password !== req.body.confirmPassword) {
    return next(new AppError("Passwords do not match", 400));
  }

  // Update the user's password
  user.password = req.body.password;
  user.confirmPassword = req.body.confirmPassword;
  user.passwordResetToken = undefined; // Clear the reset token
  user.passwordResetExpires = undefined; // Clear the expiration time
  await user.save();

  // Generate a new token for the user
  const token = generateToken(user._id);

  res.status(200).json({
    status: "success",
    token,
  });
});

// updatePassword
exports.updatePassword = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user.id).select("+password");

  if (!(await user.correctPassword(req.body.currentPassword, user.password))) {
    return next(new AppError("Current password is incorrect", 401));
  }

  if (req.body.password !== req.body.confirmPassword) {
    return next(new AppError("Passwords do not match", 400));
  }

  user.password = req.body.password;
  await user.save();

  const token = generateToken(user._id);
  res.status(200).json({
    status: "success",
    token,
  });
});
