const Order = require('../models/Order.model');
const User = require('../models/User.model');
const SupplierListing = require('../models/SupplierListing.model');
const asyncHandler = require('../utils/asynchandler');
const ApiResponse = require('../utils/apiResponse');
const ApiError = require('../utils/apiError');

// Place an order
const placeOrder = asyncHandler(async (req, res) => {
    const {
        productId,
        quantity,
        deliveryType = 'delivery',
        deliveryAddress,
        pickupAddress,
        notes
    } = req.body;

    if (!productId || !quantity) {
        throw new ApiError(400, 'Product ID and quantity are required');
    }

    // Get product details
    const product = await SupplierListing.findOne({ 
        _id: productId, 
        isActive: true 
    }).populate('userId', 'name username isSupplier address');

    if (!product) {
        throw new ApiError(404, 'Product not found or not available');
    }

    const sellerId = product.userId._id;

    // Verify seller
    if (!product.userId.isSupplier) {
        throw new ApiError(400, 'Product owner is not a valid supplier');
    }

    // Check if buyer is trying to buy their own product
    if (sellerId.toString() === req.user._id) {
        throw new ApiError(400, 'You cannot place an order for your own product');
    }

    // Check product availability
    if (product.quantityAvailable < quantity) {
        throw new ApiError(400, `Insufficient quantity. Available: ${product.quantityAvailable} ${product.unit}`);
    }

    // Check seller's pending orders limit
    const sellerLimit = await Order.checkSellerPendingLimit(sellerId);
    if (!sellerLimit.canAcceptMore) {
        throw new ApiError(400, sellerLimit.message);
    }

    // Address validation
    let finalDeliveryAddress = deliveryAddress;
    let finalPickupAddress = pickupAddress;

    if (deliveryType === 'delivery') {
        if (!deliveryAddress) {
            // Auto-use buyer's address
            const buyer = await User.findById(req.user._id).select('address');
            if (buyer.address && buyer.address.street) {
                finalDeliveryAddress = `${buyer.address.street}, ${buyer.address.city}, ${buyer.address.state} - ${buyer.address.pincode}`;
            } else {
                throw new ApiError(400, 'Delivery address required. Please update your profile address or provide delivery address.');
            }
        }
    } else {
        if (!pickupAddress) {
            finalPickupAddress = product.location.address;
        }
    }

    // Calculate pricing
    const basePrice = product.pricePerUnit * quantity;
    const deliveryFee = deliveryType === 'delivery' && product.deliveryAvailable ? product.deliveryFee : 0;
    const totalPrice = basePrice + deliveryFee;

    // Calculate expected delivery date
    const expectedDeliveryDate = new Date();
    expectedDeliveryDate.setDate(expectedDeliveryDate.getDate() + (deliveryType === 'delivery' ? 7 : 3));

    // Create order
    const order = new Order({
        buyerId: req.user._id,
        sellerId,
        listingId: productId,
        itemName: product.itemName,
        quantity,
        unit: product.unit,
        basePrice,
        deliveryFee,
        totalPrice,
        deliveryType,
        orderType: 'from-listing',
        deliveryAddress: finalDeliveryAddress,
        pickupAddress: finalPickupAddress,
        expectedDeliveryDate,
        notes: notes || `Order for ${quantity} ${product.unit} of ${product.itemName}`,
        // Store product snapshot for history
        productSnapshot: {
            itemName: product.itemName,
            imageUrl: product.imageUrl,
            category: product.category,
            type: product.type,
            description: product.description,
            sellerLocation: product.location
        }
    });

    await order.save();

    // Populate order details for response
    await order.populate([
        { path: 'buyerId', select: 'name username phone email' },
        { path: 'sellerId', select: 'name username phone email rating trustScore' },
        { path: 'listingId', select: 'itemName imageUrl category type pricePerUnit' }
    ]);

    res.status(201).json(
        new ApiResponse(201, order, 'Order placed successfully! Seller will be notified.')
    );
});

// Get user's order history (as buyer)
const getBuyerOrderHistory = asyncHandler(async (req, res) => {
    const { page = 1, limit = 10, status } = req.query;

    const filter = { buyerId: req.user._id };
    if (status) filter.status = status;

    const skip = (page - 1) * limit;

    const orders = await Order.find(filter)
        .populate('sellerId', 'name username rating trustScore phone')
        .populate('listingId', 'itemName imageUrl category type')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit));

    const total = await Order.countDocuments(filter);

    // Enhanced order data
    const enhancedOrders = orders.map(order => {
        const orderObj = order.toObject();
        orderObj.canReview = order.isReviewable && !order.reviewId;
        orderObj.daysOld = Math.floor((new Date() - order.createdAt) / (1000 * 60 * 60 * 24));
        orderObj.statusColor = getOrderStatusColor(order.status);
        orderObj.nextAction = getBuyerNextAction(order);
        return orderObj;
    });

    res.status(200).json(
        new ApiResponse(200, {
            orders: enhancedOrders,
            pagination: {
                current: Number(page),
                pages: Math.ceil(total / limit),
                total,
                hasNext: page < Math.ceil(total / limit),
                hasPrev: page > 1
            }
        }, 'Buyer order history fetched successfully')
    );
});

// Get seller's order management (incoming orders)
const getSellerOrders = asyncHandler(async (req, res) => {
    const { page = 1, limit = 10, status } = req.query;

    if (!req.user.isSupplier) {
        throw new ApiError(403, 'Only suppliers can view seller orders');
    }

    const filter = { sellerId: req.user._id };
    if (status) filter.status = status;

    const skip = (page - 1) * limit;

    const orders = await Order.find(filter)
        .populate('buyerId', 'name username rating trustScore phone email')
        .populate('listingId', 'itemName imageUrl category type')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit));

    const total = await Order.countDocuments(filter);

    // Enhanced order data with seller actions
    const enhancedOrders = orders.map(order => {
        const orderObj = order.toObject();
        orderObj.daysOld = Math.floor((new Date() - order.createdAt) / (1000 * 60 * 60 * 24));
        orderObj.statusColor = getOrderStatusColor(order.status);
        orderObj.nextAction = getSellerNextAction(order);
        orderObj.buyerInfo = {
            name: order.buyerId.name,
            username: order.buyerId.username,
            rating: order.buyerId.rating,
            phone: order.buyerId.phone
        };
        return orderObj;
    });

    // Get seller statistics
    const sellerLimit = await Order.checkSellerPendingLimit(req.user._id);

    res.status(200).json(
        new ApiResponse(200, {
            orders: enhancedOrders,
            sellerStats: sellerLimit,
            pagination: {
                current: Number(page),
                pages: Math.ceil(total / limit),
                total,
                hasNext: page < Math.ceil(total / limit),
                hasPrev: page > 1
            }
        }, 'Seller orders fetched successfully')
    );
});

// Update order status (seller actions)
const updateOrderStatus = asyncHandler(async (req, res) => {
    const { orderId } = req.params;
    const { action, notes } = req.body; // action: 'confirm', 'ship', 'cancel'

    if (!['confirm', 'ship', 'cancel'].includes(action)) {
        throw new ApiError(400, 'Invalid action. Must be confirm, ship, or cancel');
    }

    const order = await Order.findById(orderId);
    if (!order) {
        throw new ApiError(404, 'Order not found');
    }

    // Check if current user is the seller
    if (order.sellerId.toString() !== req.user._id) {
        throw new ApiError(403, 'You can only update your own orders');
    }

    // Validate status transitions
    const validTransitions = {
        'pending': ['confirm', 'cancel'],
        'confirmed': ['ship', 'cancel'],
        'processing': ['ship', 'cancel']
    };

    if (!validTransitions[order.status]?.includes(action)) {
        throw new ApiError(400, `Cannot ${action} order with status ${order.status}`);
    }

    // Update order status
    switch (action) {
        case 'confirm':
            order.status = 'confirmed';
            break;
        case 'ship':
            order.status = 'shipped';
            // Exchange code will be generated by pre-save middleware
            break;
        case 'cancel':
            order.status = 'cancelled';
            order.cancelReason = notes || 'Cancelled by seller';
            order.canceledAt = new Date();
            break;
    }

    if (notes && action !== 'cancel') {
        order.sellerNotes = notes;
    }

    await order.save();

    await order.populate([
        { path: 'buyerId', select: 'name username phone email' },
        { path: 'sellerId', select: 'name username phone' },
        { path: 'listingId', select: 'itemName imageUrl' }
    ]);

    res.status(200).json(
        new ApiResponse(200, order, `Order ${action}ed successfully`)
    );
});

// Mark order as delivered/completed (buyer action)
const markOrderCompleted = asyncHandler(async (req, res) => {
    const { orderId } = req.params;
    const { exchangeCode } = req.body;

    const order = await Order.findById(orderId);
    if (!order) {
        throw new ApiError(404, 'Order not found');
    }

    // Check if current user is the buyer
    if (order.buyerId.toString() !== req.user._id) {
        throw new ApiError(403, 'You can only complete your own orders');
    }

    if (order.status !== 'shipped') {
        throw new ApiError(400, 'Order must be shipped before marking as completed');
    }

    // Verify exchange code
    if (!exchangeCode || order.exchangeCode !== exchangeCode) {
        throw new ApiError(400, 'Invalid or missing exchange code');
    }

    order.status = 'completed';
    order.completedAt = new Date();
    await order.save();

    await order.populate([
        { path: 'buyerId', select: 'name username' },
        { path: 'sellerId', select: 'name username' },
        { path: 'listingId', select: 'itemName imageUrl' }
    ]);

    res.status(200).json(
        new ApiResponse(200, order, 'Order completed successfully! You can now leave a review.')
    );
});

// Get order details
const getOrderDetails = asyncHandler(async (req, res) => {
    const { orderId } = req.params;

    const order = await Order.findById(orderId)
        .populate('buyerId', 'name username phone email rating trustScore address')
        .populate('sellerId', 'name username phone email rating trustScore address')
        .populate('listingId', 'itemName imageUrl category type description location')
        .populate('reviewId');

    if (!order) {
        throw new ApiError(404, 'Order not found');
    }

    // Check if user is involved in this order
    const isInvolved = order.buyerId._id.toString() === req.user._id || 
                      order.sellerId._id.toString() === req.user._id;

    if (!isInvolved) {
        throw new ApiError(403, 'You are not authorized to view this order');
    }

    // Enhanced order with timeline
    const orderObj = order.toObject();
    orderObj.userRole = order.buyerId._id.toString() === req.user._id ? 'buyer' : 'seller';
    orderObj.timeline = generateOrderTimeline(order);
    orderObj.canReview = order.isReviewable && !order.reviewId && orderObj.userRole === 'buyer';

    res.status(200).json(
        new ApiResponse(200, orderObj, 'Order details fetched successfully')
    );
});

// Get order dashboard/summary
const getOrderDashboard = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    // Get order statistics
    const orderStats = await Order.getUserOrderStats(userId);

    // Get recent orders
    const recentOrders = await Order.find({
        $or: [
            { buyerId: userId },
            { sellerId: userId }
        ]
    })
    .populate('buyerId', 'name username')
    .populate('sellerId', 'name username')
    .populate('listingId', 'itemName imageUrl')
    .sort({ updatedAt: -1 })
    .limit(5);

    // Enhance recent orders
    const enhancedRecent = recentOrders.map(order => {
        const orderObj = order.toObject();
        orderObj.userRole = order.buyerId._id.toString() === userId ? 'buyer' : 'seller';
        orderObj.counterparty = orderObj.userRole === 'buyer' ? order.sellerId : order.buyerId;
        return orderObj;
    });

    // Get reviewable orders
    const reviewableOrders = await Order.countDocuments({
        buyerId: userId,
        isReviewable: true,
        reviewId: { $exists: false }
    });

    const dashboardData = {
        statistics: {
            asBuyer: processOrderStats(orderStats.asBuyer),
            asSeller: req.user.isSupplier ? processOrderStats(orderStats.asSeller) : null
        },
        recentOrders: enhancedRecent,
        reviewableCount: reviewableOrders
    };

    res.status(200).json(
        new ApiResponse(200, dashboardData, 'Order dashboard fetched successfully')
    );
});

// Helper functions
const getOrderStatusColor = (status) => {
    const colors = {
        'pending': '#f59e0b',      // amber
        'confirmed': '#3b82f6',    // blue
        'processing': '#8b5cf6',   // purple
        'shipped': '#06b6d4',      // cyan
        'delivered': '#10b981',    // green
        'completed': '#6b7280',    // gray
        'cancelled': '#ef4444'     // red
    };
    return colors[status] || '#6b7280';
};

const getBuyerNextAction = (order) => {
    switch (order.status) {
        case 'pending':
            return 'Waiting for seller confirmation';
        case 'confirmed':
            return 'Order confirmed, preparing for shipment';
        case 'processing':
            return 'Order being processed';
        case 'shipped':
            return 'Mark as received when delivered';
        case 'completed':
            return order.reviewId ? 'Order completed' : 'Leave a review';
        case 'cancelled':
            return 'Order was cancelled';
        default:
            return 'No action required';
    }
};

const getSellerNextAction = (order) => {
    switch (order.status) {
        case 'pending':
            return 'Confirm or cancel order';
        case 'confirmed':
            return 'Process and ship order';
        case 'processing':
            return 'Ship order when ready';
        case 'shipped':
            return 'Waiting for buyer confirmation';
        case 'completed':
            return 'Order completed successfully';
        case 'cancelled':
            return 'Order was cancelled';
        default:
            return 'No action required';
    }
};

const generateOrderTimeline = (order) => {
    const timeline = [
        {
            status: 'placed',
            date: order.createdAt,
            description: `Order placed by ${order.buyerId.name}`,
            completed: true
        }
    ];

    if (order.status !== 'pending') {
        timeline.push({
            status: 'confirmed',
            date: order.updatedAt,
            description: `Order confirmed by ${order.sellerId.name}`,
            completed: true
        });
    }

    if (order.status === 'shipped' || order.status === 'completed') {
        timeline.push({
            status: 'shipped',
            date: order.updatedAt,
            description: 'Order shipped',
            completed: true
        });
    }

    if (order.status === 'completed') {
        timeline.push({
            status: 'completed',
            date: order.completedAt,
            description: 'Order completed',
            completed: true
        });
    }

    if (order.status === 'cancelled') {
        timeline.push({
            status: 'cancelled',
            date: order.canceledAt,
            description: `Order cancelled: ${order.cancelReason}`,
            completed: true
        });
    }

    return timeline;
};

const processOrderStats = (stats) => {
    const result = {
        pending: 0,
        confirmed: 0,
        processing: 0,
        shipped: 0,
        completed: 0,
        cancelled: 0,
        totalAmount: 0,
        totalOrders: 0
    };

    stats.forEach(stat => {
        result[stat._id] = stat.count;
        result.totalAmount += stat.totalAmount;
        result.totalOrders += stat.count;
    });

    return result;
};

module.exports = {
    placeOrder,
    getBuyerOrderHistory,
    getSellerOrders,
    updateOrderStatus,
    markOrderCompleted,
    getOrderDetails,
    getOrderDashboard
};
