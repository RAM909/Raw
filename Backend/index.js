const express = require('express');
const connectDB = require('./src/config/db.js');
const dotenv = require('dotenv');
const cookieParser = require('cookie-parser');
const Cors = require('cors');
const fileUpload = require('express-fileupload');

// Load environment variables from .env file
dotenv.config();

// Connect to the database
connectDB();

// Create Express app
const app = express();

// CORS configuration
app.use(Cors({
    origin: ['http://localhost:5173', 'http://localhost:3000', 'http://localhost:5000'],
    credentials: true
}));

// Middleware to parse JSON
app.use(express.json()); // This is a built-in middleware function in Express. It parses incoming requests with JSON payloads and is based on body-parser.
app.use(express.urlencoded({ extended: true })); // This is a built-in middleware function in Express. It parses incoming requests with urlencoded payloads and is based on body-parser.
app.use(express.static('public')); // This is a built-in middleware function in Express. It serves static files and is based on serve-static.

// Middleware to parse cookies
app.use(cookieParser()); // This is a third-party middleware function in Express. It parses cookies attached to the client request object.

// File upload middleware
app.use(fileUpload({
  useTempFiles: true,
  tempFileDir: '/tmp/',
  limits: { fileSize: 50 * 1024 * 1024 }, // Optional: limit file size to 50MB
  abortOnLimit: true, // Optional: return 413 when file size is exceeded
})); // This is a third-party middleware function in Express. It parses file uploads and is based on express-fileupload.

// Import routes
const userRouter = require('./src/routes/user.route');
const supplierListingRouter = require('./src/routes/SupplierListing.route');
const sampleRouter = require('./src/routes/sample.route');
const analyticsRouter = require('./src/routes/analytics.route');
const userProfileRouter = require('./src/routes/userProfile.route');
const orderRouter = require('./src/routes/order.route');
const reviewRouter = require('./src/routes/review.route');
const materialRequestRouter = require('./src/routes/materialRequest.route');
const notificationRouter = require('./src/routes/notification.route');
const negotiationRouter = require('./src/routes/negotiation.route');

// Define routes
app.use('/api/users', userRouter);    // Mount the user router at the correct endpoint
app.use('/api/products', supplierListingRouter);    // Mount the supplier listing (products) router
app.use('/api/samples', sampleRouter);    // Mount the sample router
app.use('/api/analytics', analyticsRouter);    // Mount the analytics router
app.use('/api/orders', orderRouter);    // Mount the order router
app.use('/api/reviews', reviewRouter);    // Mount the review router
app.use('/api/profile', userProfileRouter);    // Mount the user profile router
app.use('/api/material-requests', materialRequestRouter);    // Mount the material request router
app.use('/api/notifications', notificationRouter);    // Mount the notification router
app.use('/api/negotiations', negotiationRouter);    // Mount the negotiation router

// Define a simple route
app.get('/', (req, res) => {
  res.send('API is running...');
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});