const express = require('express');
const router = express.Router();
const {
    placeOrder,
    getBuyerOrderHistory,
    getSellerOrders,
    updateOrderStatus,
    markOrderCompleted,
    getOrderDetails,
    getOrderDashboard
} = require('../controllers/order.controller');
const auth = require('../middlewares/auth.middleware');

// All routes require authentication
router.use(auth);

// Order management routes
router.post('/place', placeOrder);                           // Place an order
router.get('/buyer/history', getBuyerOrderHistory);          // Get buyer's order history
router.get('/seller/orders', getSellerOrders);               // Get seller's incoming orders
router.patch('/:orderId/status', updateOrderStatus);         // Update order status (seller)
router.patch('/:orderId/complete', markOrderCompleted);      // Mark order as completed (buyer)
router.get('/dashboard', getOrderDashboard);                 // Get order dashboard/summary
router.get('/:orderId', getOrderDetails);                    // Get order details

module.exports = router;
