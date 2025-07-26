const Negotiation = require('../models/Negotiation.model');
const Order = require('../models/Order.model');
const MaterialRequest = require('../models/MaterialRequest.model');
const MaterialRequestAcceptance = require('../models/MaterialRequestAcceptance.model');
const User = require('../models/User.model');
const Notification = require('../models/Notification.model');
const asyncHandler = require('../utils/asynchandler');
const ApiResponse = require('../utils/apiResponse');
const ApiError = require('../utils/apiError');
const mongoose = require('mongoose');

// Create a new negotiation (initiated by buyer)
const createNegotiation = asyncHandler(async (req, res) => {
    const {
        negotiationType, // 'order' or 'material_request'
        orderId,
        materialRequestAcceptanceId,
        sellerId,
        initialOffer,
        message
    } = req.body;

    const buyerId = req.user._id;

    // Validate the negotiation type and required references
    if (negotiationType === 'order' && !orderId) {
        throw new ApiError(400, 'Order ID is required for order negotiations');
    }

    if (negotiationType === 'material_request' && !materialRequestAcceptanceId) {
        throw new ApiError(400, 'Material Request Acceptance ID is required for material request negotiations');
    }

    // Check if negotiation already exists
    let existingNegotiation;
    if (negotiationType === 'order') {
        existingNegotiation = await Negotiation.findOne({ 
            orderId, 
            negotiationStatus: { $in: ['active', 'agreed'] } 
        });
    } else {
        existingNegotiation = await Negotiation.findOne({ 
            materialRequestAcceptanceId, 
            negotiationStatus: { $in: ['active', 'agreed'] } 
        });
    }

    if (existingNegotiation) {
        throw new ApiError(400, 'A negotiation for this item is already active');
    }

    // Get reference data
    let referenceData = {};
    let materialRequestId = null;

    if (negotiationType === 'order') {
        const order = await Order.findById(orderId).populate('listingId');
        if (!order) {
            throw new ApiError(404, 'Order not found');
        }
        if (order.buyerId.toString() !== buyerId.toString()) {
            throw new ApiError(403, 'You can only negotiate your own orders');
        }
        referenceData = {
            itemName: order.itemName,
            originalPrice: order.pricePerUnit,
            quantity: order.quantity
        };
    } else {
        const acceptance = await MaterialRequestAcceptance.findById(materialRequestAcceptanceId)
            .populate('requestId');
        if (!acceptance) {
            throw new ApiError(404, 'Material request acceptance not found');
        }
        if (acceptance.buyerId.toString() !== buyerId.toString()) {
            throw new ApiError(403, 'You can only negotiate your own material requests');
        }
        materialRequestId = acceptance.requestId._id;
        referenceData = {
            itemName: acceptance.requestId.itemName,
            originalPrice: acceptance.offerPrice,
            quantity: acceptance.requestId.quantityRequired
        };
    }

    // Create the negotiation
    const negotiation = await Negotiation.create({
        orderId: negotiationType === 'order' ? orderId : undefined,
        materialRequestId,
        materialRequestAcceptanceId: negotiationType === 'material_request' ? materialRequestAcceptanceId : undefined,
        buyerId,
        sellerId,
        negotiationType,
        initialOffer: {
            ...initialOffer,
            totalPrice: initialOffer.basePrice + (initialOffer.deliveryFee || 0)
        },
        messages: [{
            senderId: buyerId,
            message: message || `Starting negotiation for ${referenceData.itemName}`,
            messageType: 'text'
        }, {
            senderId: buyerId,
            message: `Initial offer: ₹${initialOffer.basePrice} for ${initialOffer.quantity} ${initialOffer.unit}`,
            messageType: 'price-offer',
            priceOffer: {
                ...initialOffer,
                totalPrice: initialOffer.basePrice + (initialOffer.deliveryFee || 0)
            }
        }]
    });

    await negotiation.populate([
        { path: 'buyerId', select: 'name username' },
        { path: 'sellerId', select: 'name username' }
    ]);

    // Create notification for seller
    await Notification.create({
        userId: sellerId,
        type: 'negotiation_started',
        title: 'New Negotiation Started',
        message: `${req.user.name} wants to negotiate terms for ${referenceData.itemName}`,
        data: {
            negotiationId: negotiation._id,
            buyerId,
            itemName: referenceData.itemName,
            initialOffer: initialOffer.totalPrice,
            negotiationType
        },
        actionRequired: true,
        category: negotiationType,
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000) // 48 hours
    });

    res.status(201).json(
        new ApiResponse(201, negotiation, 'Negotiation created successfully')
    );
});

// Get negotiations for a user
const getUserNegotiations = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { 
        page = 1, 
        limit = 10, 
        status = 'all', 
        type = 'all', 
        role = 'all' 
    } = req.query;

    const skip = (page - 1) * limit;
    let query = {};

    // Role-based filtering
    if (role === 'buyer') {
        query.buyerId = userId;
    } else if (role === 'seller') {
        query.sellerId = userId;
    } else {
        query.$or = [{ buyerId: userId }, { sellerId: userId }];
    }

    // Status filtering
    if (status !== 'all') {
        query.negotiationStatus = status;
    }

    // Type filtering
    if (type !== 'all') {
        query.negotiationType = type;
    }

    const [negotiations, total] = await Promise.all([
        Negotiation.find(query)
            .populate('buyerId', 'name username rating')
            .populate('sellerId', 'name username rating')
            .populate({
                path: 'orderId',
                select: 'itemName listingId',
                populate: {
                    path: 'listingId',
                    select: 'itemName imageUrl'
                }
            })
            .populate({
                path: 'materialRequestId',
                select: 'itemName imageUrl category'
            })
            .sort({ lastActivity: -1 })
            .skip(skip)
            .limit(Number(limit)),
        Negotiation.countDocuments(query)
    ]);

    // Enhanced negotiations with additional info
    const enhancedNegotiations = negotiations.map(negotiation => {
        const negotiationObj = negotiation.toObject();
        negotiationObj.userRole = negotiation.buyerId._id.toString() === userId ? 'buyer' : 'seller';
        negotiationObj.counterparty = negotiationObj.userRole === 'buyer' ? negotiation.sellerId : negotiation.buyerId;
        negotiationObj.unreadCount = negotiation.messages.filter(msg => 
            !msg.isRead && msg.senderId.toString() !== userId
        ).length;
        negotiationObj.lastMessage = negotiation.messages[negotiation.messages.length - 1];
        negotiationObj.timeAgo = getTimeAgo(negotiation.lastActivity);
        negotiationObj.statusColor = getNegotiationStatusColor(negotiation.negotiationStatus);
        negotiationObj.isExpired = negotiation.expiresAt < new Date();
        negotiationObj.itemName = negotiation.orderId?.itemName || negotiation.materialRequestId?.itemName;
        negotiationObj.itemImage = negotiation.orderId?.listingId?.imageUrl || negotiation.materialRequestId?.imageUrl;
        return negotiationObj;
    });

    res.status(200).json(
        new ApiResponse(200, {
            negotiations: enhancedNegotiations,
            pagination: {
                current: Number(page),
                pages: Math.ceil(total / limit),
                total,
                hasNext: page < Math.ceil(total / limit),
                hasPrev: page > 1
            }
        }, 'Negotiations fetched successfully')
    );
});

// Get specific negotiation details
const getNegotiationDetails = asyncHandler(async (req, res) => {
    const { negotiationId } = req.params;
    const userId = req.user._id;

    const negotiation = await Negotiation.findById(negotiationId)
        .populate('buyerId', 'name username rating')
        .populate('sellerId', 'name username rating')
        .populate({
            path: 'orderId',
            select: 'itemName quantity unit pricePerUnit listingId',
            populate: {
                path: 'listingId',
                select: 'itemName imageUrl category type pricePerUnit quantityAvailable'
            }
        })
        .populate({
            path: 'materialRequestId',
            select: 'itemName imageUrl category type quantityRequired unit willingPrice'
        })
        .populate({
            path: 'materialRequestAcceptanceId',
            select: 'offerPrice deliveryOffered deliveryFee message'
        });

    if (!negotiation) {
        throw new ApiError(404, 'Negotiation not found');
    }

    // Check if user is part of this negotiation
    if (negotiation.buyerId._id.toString() !== userId && negotiation.sellerId._id.toString() !== userId) {
        throw new ApiError(403, 'You are not authorized to view this negotiation');
    }

    // Mark messages as read for the current user
    let hasUnreadMessages = false;
    negotiation.messages.forEach(message => {
        if (!message.isRead && message.senderId.toString() !== userId) {
            message.isRead = true;
            hasUnreadMessages = true;
        }
    });

    if (hasUnreadMessages) {
        await negotiation.save();
    }

    // Enhanced negotiation details
    const negotiationObj = negotiation.toObject();
    negotiationObj.userRole = negotiation.buyerId._id.toString() === userId ? 'buyer' : 'seller';
    negotiationObj.counterparty = negotiationObj.userRole === 'buyer' ? negotiation.sellerId : negotiation.buyerId;
    negotiationObj.canMakeOffer = negotiation.negotiationStatus === 'active';
    negotiationObj.canAcceptOffer = negotiation.negotiationStatus === 'active' && 
        negotiation.messages.some(msg => 
            msg.messageType === 'price-offer' && 
            msg.senderId.toString() !== userId
        );
    negotiationObj.isExpired = negotiation.expiresAt < new Date();
    negotiationObj.hoursLeft = Math.max(0, Math.ceil((negotiation.expiresAt - new Date()) / (1000 * 60 * 60)));

    res.status(200).json(
        new ApiResponse(200, negotiationObj, 'Negotiation details fetched successfully')
    );
});

// Send a message in negotiation
const sendNegotiationMessage = asyncHandler(async (req, res) => {
    const { negotiationId } = req.params;
    const { message, messageType = 'text', priceOffer } = req.body;
    const userId = req.user._id;

    const negotiation = await Negotiation.findById(negotiationId);

    if (!negotiation) {
        throw new ApiError(404, 'Negotiation not found');
    }

    // Check if user is part of this negotiation
    if (negotiation.buyerId.toString() !== userId && negotiation.sellerId.toString() !== userId) {
        throw new ApiError(403, 'You are not authorized to send messages in this negotiation');
    }

    if (negotiation.negotiationStatus !== 'active') {
        throw new ApiError(400, 'This negotiation is no longer active');
    }

    if (negotiation.expiresAt < new Date()) {
        throw new ApiError(400, 'This negotiation has expired');
    }

    // Prepare the new message
    const newMessage = {
        senderId: userId,
        message,
        messageType,
        timestamp: new Date(),
        isRead: false
    };

    // Add price offer details if it's a price offer message
    if (messageType === 'price-offer' && priceOffer) {
        newMessage.priceOffer = {
            ...priceOffer,
            totalPrice: priceOffer.basePrice + (priceOffer.deliveryFee || 0)
        };
    }

    // Add the message
    negotiation.messages.push(newMessage);
    negotiation.lastActivity = new Date();
    await negotiation.save();

    // Populate the negotiation for response
    await negotiation.populate([
        { path: 'buyerId', select: 'name username' },
        { path: 'sellerId', select: 'name username' }
    ]);

    // Send notification to the other party
    const otherUserId = negotiation.buyerId._id.toString() === userId ? 
        negotiation.sellerId._id : negotiation.buyerId._id;

    const notificationType = messageType === 'price-offer' ? 
        'negotiation_offer' : 'negotiation_message';

    await Notification.create({
        userId: otherUserId,
        type: notificationType,
        title: messageType === 'price-offer' ? 'New Price Offer' : 'New Negotiation Message',
        message: messageType === 'price-offer' ? 
            `${req.user.name} sent a new price offer: ₹${newMessage.priceOffer.totalPrice}` :
            `${req.user.name}: ${message.substring(0, 50)}${message.length > 50 ? '...' : ''}`,
        data: {
            negotiationId: negotiation._id,
            senderId: userId,
            messageType,
            priceOffer: messageType === 'price-offer' ? newMessage.priceOffer : undefined
        },
        actionRequired: messageType === 'price-offer',
        category: negotiation.negotiationType
    });

    res.status(200).json(
        new ApiResponse(200, {
            message: newMessage,
            negotiation: {
                _id: negotiation._id,
                lastActivity: negotiation.lastActivity,
                messagesCount: negotiation.messages.length
            }
        }, 'Message sent successfully')
    );
});

// Accept a price offer and finalize negotiation
const acceptNegotiationOffer = asyncHandler(async (req, res) => {
    const { negotiationId } = req.params;
    const { messageId } = req.body; // ID of the message containing the offer to accept
    const userId = req.user._id;

    const negotiation = await Negotiation.findById(negotiationId);

    if (!negotiation) {
        throw new ApiError(404, 'Negotiation not found');
    }

    // Check if user is part of this negotiation
    if (negotiation.buyerId.toString() !== userId && negotiation.sellerId.toString() !== userId) {
        throw new ApiError(403, 'You are not authorized to accept offers in this negotiation');
    }

    if (negotiation.negotiationStatus !== 'active') {
        throw new ApiError(400, 'This negotiation is no longer active');
    }

    // Find the message with the offer
    const offerMessage = negotiation.messages.id(messageId);
    if (!offerMessage || offerMessage.messageType !== 'price-offer') {
        throw new ApiError(400, 'Invalid offer message');
    }

    // Check if the offer is from the other party
    if (offerMessage.senderId.toString() === userId) {
        throw new ApiError(400, 'You cannot accept your own offer');
    }

    // Update negotiation status and final agreed price
    negotiation.negotiationStatus = 'agreed';
    negotiation.isNegotiated = true;
    negotiation.finalPriceAgreed = {
        ...offerMessage.priceOffer,
        agreedAt: new Date()
    };

    // Add system message about agreement
    negotiation.messages.push({
        senderId: userId,
        message: `Offer accepted! Final price: ₹${offerMessage.priceOffer.totalPrice} for ${offerMessage.priceOffer.quantity} ${offerMessage.priceOffer.unit}`,
        messageType: 'system',
        timestamp: new Date(),
        isRead: false
    });

    await negotiation.save();

    // Send notifications to both parties
    const otherUserId = negotiation.buyerId._id.toString() === userId ? 
        negotiation.sellerId._id : negotiation.buyerId._id;

    await Promise.all([
        // Notification to the person who made the offer
        Notification.create({
            userId: otherUserId,
            type: 'negotiation_accepted',
            title: 'Offer Accepted!',
            message: `${req.user.name} accepted your offer of ₹${offerMessage.priceOffer.totalPrice}`,
            data: {
                negotiationId: negotiation._id,
                finalPrice: offerMessage.priceOffer.totalPrice,
                acceptedBy: userId
            },
            actionRequired: true,
            category: negotiation.negotiationType
        }),

        // Notification to the person who accepted
        Notification.create({
            userId: userId,
            type: 'negotiation_confirmed',
            title: 'Deal Confirmed',
            message: `You have accepted the offer. You can now place the order.`,
            data: {
                negotiationId: negotiation._id,
                finalPrice: offerMessage.priceOffer.totalPrice,
                canPlaceOrder: true
            },
            actionRequired: true,
            category: negotiation.negotiationType
        })
    ]);

    res.status(200).json(
        new ApiResponse(200, {
            negotiation,
            finalOffer: offerMessage.priceOffer,
            canPlaceOrder: true
        }, 'Offer accepted successfully')
    );
});

// Cancel a negotiation
const cancelNegotiation = asyncHandler(async (req, res) => {
    const { negotiationId } = req.params;
    const { reason } = req.body;
    const userId = req.user._id;

    const negotiation = await Negotiation.findById(negotiationId);

    if (!negotiation) {
        throw new ApiError(404, 'Negotiation not found');
    }

    // Check if user is part of this negotiation
    if (negotiation.buyerId.toString() !== userId && negotiation.sellerId.toString() !== userId) {
        throw new ApiError(403, 'You are not authorized to cancel this negotiation');
    }

    if (negotiation.negotiationStatus !== 'active') {
        throw new ApiError(400, 'This negotiation is not active');
    }

    // Update negotiation status
    negotiation.negotiationStatus = 'canceled';

    // Add system message about cancellation
    negotiation.messages.push({
        senderId: userId,
        message: `Negotiation canceled${reason ? `: ${reason}` : ''}`,
        messageType: 'system',
        timestamp: new Date(),
        isRead: false
    });

    await negotiation.save();

    // Send notification to the other party
    const otherUserId = negotiation.buyerId._id.toString() === userId ? 
        negotiation.sellerId._id : negotiation.buyerId._id;

    await Notification.create({
        userId: otherUserId,
        type: 'negotiation_canceled',
        title: 'Negotiation Canceled',
        message: `${req.user.name} canceled the negotiation${reason ? `: ${reason}` : ''}`,
        data: {
            negotiationId: negotiation._id,
            canceledBy: userId,
            reason
        },
        category: negotiation.negotiationType
    });

    res.status(200).json(
        new ApiResponse(200, negotiation, 'Negotiation canceled successfully')
    );
});

// Get negotiation statistics for dashboard
const getNegotiationStats = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    const stats = await Negotiation.aggregate([
        {
            $match: {
                $or: [{ buyerId: new mongoose.Types.ObjectId(userId) }, { sellerId: new mongoose.Types.ObjectId(userId) }]
            }
        },
        {
            $group: {
                _id: null,
                totalNegotiations: { $sum: 1 },
                activeNegotiations: { $sum: { $cond: [{ $eq: ['$negotiationStatus', 'active'] }, 1, 0] } },
                agreedNegotiations: { $sum: { $cond: [{ $eq: ['$negotiationStatus', 'agreed'] }, 1, 0] } },
                canceledNegotiations: { $sum: { $cond: [{ $eq: ['$negotiationStatus', 'canceled'] }, 1, 0] } },
                asBuyer: { $sum: { $cond: [{ $eq: ['$buyerId', new mongoose.Types.ObjectId(userId)] }, 1, 0] } },
                asSeller: { $sum: { $cond: [{ $eq: ['$sellerId', new mongoose.Types.ObjectId(userId)] }, 1, 0] } }
            }
        }
    ]);

    const successRate = stats[0] ? 
        ((stats[0].agreedNegotiations / stats[0].totalNegotiations) * 100).toFixed(1) : 0;

    res.status(200).json(
        new ApiResponse(200, {
            ...(stats[0] || {
                totalNegotiations: 0,
                activeNegotiations: 0,
                agreedNegotiations: 0,
                canceledNegotiations: 0,
                asBuyer: 0,
                asSeller: 0
            }),
            successRate: parseFloat(successRate)
        }, 'Negotiation statistics fetched successfully')
    );
});

// Helper functions
const getTimeAgo = (date) => {
    const seconds = Math.floor((new Date() - date) / 1000);
    
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 2592000) return `${Math.floor(seconds / 86400)}d ago`;
    
    return date.toLocaleDateString();
};

const getNegotiationStatusColor = (status) => {
    switch (status) {
        case 'active': return '#3b82f6';
        case 'agreed': return '#10b981';
        case 'canceled': return '#ef4444';
        case 'expired': return '#6b7280';
        default: return '#6b7280';
    }
};

module.exports = {
    createNegotiation,
    getUserNegotiations,
    getNegotiationDetails,
    sendNegotiationMessage,
    acceptNegotiationOffer,
    cancelNegotiation,
    getNegotiationStats
};
