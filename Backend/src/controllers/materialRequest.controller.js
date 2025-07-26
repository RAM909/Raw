const MaterialRequest = require('../models/MaterialRequest.model');
const MaterialRequestAcceptance = require('../models/MaterialRequestAcceptance.model');
const User = require('../models/User.model');
const Notification = require('../models/Notification.model');
const asyncHandler = require('../utils/asynchandler');
const ApiResponse = require('../utils/apiResponse');
const ApiError = require('../utils/apiError');
const mongoose = require('mongoose');

// Create a new material request
const createMaterialRequest = asyncHandler(async (req, res) => {
    const {
        itemName,
        imageUrl,
        quantityRequired,
        unit,
        willingPrice,
        deliveryNeeded,
        maxDeliveryFee,
        location,
        type,
        category,
        description,
        urgency,
        validityDays = 7
    } = req.body;

    const userId = req.user._id;

    // Calculate expiration date
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + validityDays);

    const materialRequest = await MaterialRequest.create({
        userId,
        itemName,
        imageUrl,
        quantityRequired,
        unit,
        willingPrice,
        deliveryNeeded,
        maxDeliveryFee: deliveryNeeded ? maxDeliveryFee : 0,
        location,
        type,
        category,
        description,
        urgency,
        expiresAt
    });

    await materialRequest.populate('userId', 'name username location');

    res.status(201).json(
        new ApiResponse(201, materialRequest, 'Material request created successfully')
    );
});

// Get all material requests with filtering
const getMaterialRequests = asyncHandler(async (req, res) => {
    const {
        page = 1,
        limit = 10,
        category = 'all',
        type = 'all',
        urgency = 'all',
        status = 'open',
        sortBy = 'recent',
        nearLocation,
        maxDistance = 50 // in km
    } = req.query;

    const skip = (page - 1) * limit;
    let query = { status: status === 'all' ? { $ne: 'expired' } : status };

    // Apply filters
    if (category !== 'all') query.category = category;
    if (type !== 'all') query.type = type;
    if (urgency !== 'all') query.urgency = urgency;

    // Geospatial query for nearby requests
    if (nearLocation) {
        const [lat, lng] = nearLocation.split(',').map(Number);
        query['location.lat'] = {
            $gte: lat - (maxDistance / 111), // Rough conversion: 1 degree ≈ 111 km
            $lte: lat + (maxDistance / 111)
        };
        query['location.lng'] = {
            $gte: lng - (maxDistance / 111),
            $lte: lng + (maxDistance / 111)
        };
    }

    // Sort options
    let sortOptions = {};
    switch (sortBy) {
        case 'recent':
            sortOptions = { createdAt: -1 };
            break;
        case 'urgent':
            sortOptions = { urgency: -1, createdAt: -1 };
            break;
        case 'price_high':
            sortOptions = { willingPrice: -1 };
            break;
        case 'price_low':
            sortOptions = { willingPrice: 1 };
            break;
        case 'expires_soon':
            sortOptions = { expiresAt: 1 };
            break;
        default:
            sortOptions = { createdAt: -1 };
    }

    const [requests, total] = await Promise.all([
        MaterialRequest.find(query)
            .populate('userId', 'name username rating trustScore location')
            .sort(sortOptions)
            .skip(skip)
            .limit(Number(limit)),
        MaterialRequest.countDocuments(query)
    ]);

    // Enhanced requests with additional info
    const enhancedRequests = requests.map(request => {
        const requestObj = request.toObject();
        requestObj.daysUntilExpiry = Math.ceil((request.expiresAt - new Date()) / (1000 * 60 * 60 * 24));
        requestObj.urgencyColor = getUrgencyColor(request.urgency);
        requestObj.isExpiringSoon = requestObj.daysUntilExpiry <= 2;
        requestObj.canAccept = request.userId._id.toString() !== req.user._id.toString();
        return requestObj;
    });

    res.status(200).json(
        new ApiResponse(200, {
            requests: enhancedRequests,
            pagination: {
                current: Number(page),
                pages: Math.ceil(total / limit),
                total,
                hasNext: page < Math.ceil(total / limit),
                hasPrev: page > 1
            }
        }, 'Material requests fetched successfully')
    );
});

// Accept a material request
const acceptMaterialRequest = asyncHandler(async (req, res) => {
    const { requestId } = req.params;
    const { offerPrice, deliveryOffered, deliveryFee = 0, message } = req.body;
    const sellerId = req.user._id;

    const materialRequest = await MaterialRequest.findById(requestId)
        .populate('userId', 'name username email phone');

    if (!materialRequest) {
        throw new ApiError(404, 'Material request not found');
    }

    if (materialRequest.status !== 'open') {
        throw new ApiError(400, 'This request is no longer available');
    }

    if (materialRequest.userId._id.toString() === sellerId.toString()) {
        throw new ApiError(400, 'You cannot accept your own request');
    }

    if (materialRequest.expiresAt < new Date()) {
        throw new ApiError(400, 'This request has expired');
    }

    // Create acceptance record (we'll create this model)
    const acceptance = await MaterialRequestAcceptance.create({
        requestId,
        sellerId,
        buyerId: materialRequest.userId._id,
        offerPrice,
        deliveryOffered,
        deliveryFee,
        message,
        status: 'pending' // pending, accepted, rejected
    });

    await acceptance.populate([
        { path: 'sellerId', select: 'name username rating trustScore' },
        { path: 'requestId', select: 'itemName quantityRequired unit willingPrice' }
    ]);

    // Create notifications for both buyer and seller
    await Promise.all([
        // Notification to buyer
        Notification.create({
            userId: materialRequest.userId._id,
            type: 'material_request_response',
            title: 'New Response to Your Request',
            message: `${req.user.name} wants to fulfill your request for ${materialRequest.itemName}`,
            data: {
                requestId,
                acceptanceId: acceptance._id,
                sellerId,
                offerPrice,
                deliveryOffered,
                originalPrice: materialRequest.willingPrice
            },
            actionRequired: true,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
        }),

        // Notification to seller
        Notification.create({
            userId: sellerId,
            type: 'material_request_sent',
            title: 'Request Response Sent',
            message: `Your response to ${materialRequest.userId.name}'s request for ${materialRequest.itemName} has been sent`,
            data: {
                requestId,
                acceptanceId: acceptance._id,
                buyerId: materialRequest.userId._id,
                offerPrice
            }
        })
    ]);

    res.status(200).json(
        new ApiResponse(200, acceptance, 'Material request accepted successfully')
    );
});

// Get user's material requests
const getUserMaterialRequests = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { status = 'all', page = 1, limit = 10 } = req.query;

    const skip = (page - 1) * limit;
    let query = { userId };

    if (status !== 'all') {
        query.status = status;
    }

    const [requests, total, acceptanceCount] = await Promise.all([
        MaterialRequest.find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(Number(limit)),
        MaterialRequest.countDocuments(query),
        MaterialRequestAcceptance.aggregate([
            {
                $lookup: {
                    from: 'materialrequests',
                    localField: 'requestId',
                    foreignField: '_id',
                    as: 'request'
                }
            },
            {
                $unwind: '$request'
            },
            {
                $match: { 'request.userId': new mongoose.Types.ObjectId(userId) }
            },
            {
                $group: {
                    _id: '$requestId',
                    totalResponses: { $sum: 1 },
                    pendingResponses: {
                        $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
                    }
                }
            }
        ])
    ]);

    // Enhanced requests with response counts
    const enhancedRequests = requests.map(request => {
        const requestObj = request.toObject();
        const responses = acceptanceCount.find(a => a._id.toString() === request._id.toString());
        requestObj.totalResponses = responses?.totalResponses || 0;
        requestObj.pendingResponses = responses?.pendingResponses || 0;
        requestObj.daysUntilExpiry = Math.ceil((request.expiresAt - new Date()) / (1000 * 60 * 60 * 24));
        requestObj.isExpired = request.expiresAt < new Date();
        return requestObj;
    });

    res.status(200).json(
        new ApiResponse(200, {
            requests: enhancedRequests,
            pagination: {
                current: Number(page),
                pages: Math.ceil(total / limit),
                total,
                hasNext: page < Math.ceil(total / limit),
                hasPrev: page > 1
            }
        }, 'User material requests fetched successfully')
    );
});

// Get responses to a specific material request
const getRequestResponses = asyncHandler(async (req, res) => {
    const { requestId } = req.params;
    const userId = req.user._id;

    // Verify the request belongs to the user
    const materialRequest = await MaterialRequest.findOne({
        _id: requestId,
        userId
    });

    if (!materialRequest) {
        throw new ApiError(404, 'Material request not found or access denied');
    }

    const responses = await MaterialRequestAcceptance.find({ requestId })
        .populate('sellerId', 'name username rating trustScore location')
        .sort({ createdAt: -1 });

    const enhancedResponses = responses.map(response => {
        const responseObj = response.toObject();
        responseObj.daysAgo = Math.floor((new Date() - response.createdAt) / (1000 * 60 * 60 * 24));
        responseObj.savingsAmount = materialRequest.willingPrice - response.offerPrice;
        responseObj.savingsPercentage = ((materialRequest.willingPrice - response.offerPrice) / materialRequest.willingPrice * 100).toFixed(1);
        return responseObj;
    });

    res.status(200).json(
        new ApiResponse(200, {
            request: materialRequest,
            responses: enhancedResponses
        }, 'Request responses fetched successfully')
    );
});

// Accept a seller's response (buyer accepts seller's offer)
const acceptSellerResponse = asyncHandler(async (req, res) => {
    const { acceptanceId } = req.params;
    const { action } = req.body; // 'accept' or 'reject'
    const buyerId = req.user._id;

    const acceptance = await MaterialRequestAcceptance.findById(acceptanceId)
        .populate('sellerId', 'name username email phone')
        .populate('requestId');

    if (!acceptance) {
        throw new ApiError(404, 'Response not found');
    }

    if (acceptance.buyerId.toString() !== buyerId.toString()) {
        throw new ApiError(403, 'Access denied');
    }

    if (acceptance.status !== 'pending') {
        throw new ApiError(400, 'This response has already been processed');
    }

    acceptance.status = action;
    await acceptance.save();

    if (action === 'accept') {
        // Mark the material request as fulfilled
        await MaterialRequest.findByIdAndUpdate(acceptance.requestId._id, {
            status: 'fulfilled'
        });

        // Create notifications
        await Promise.all([
            // Notification to seller
            Notification.create({
                userId: acceptance.sellerId._id,
                type: 'material_request_accepted',
                title: 'Your Response Was Accepted!',
                message: `${req.user.name} accepted your offer for ${acceptance.requestId.itemName}`,
                data: {
                    requestId: acceptance.requestId._id,
                    acceptanceId: acceptance._id,
                    buyerId,
                    offerPrice: acceptance.offerPrice
                },
                actionRequired: true
            }),

            // Notification to buyer
            Notification.create({
                userId: buyerId,
                type: 'material_request_confirmed',
                title: 'Request Confirmed',
                message: `You have confirmed ${acceptance.sellerId.name}'s offer for ${acceptance.requestId.itemName}`,
                data: {
                    requestId: acceptance.requestId._id,
                    acceptanceId: acceptance._id,
                    sellerId: acceptance.sellerId._id,
                    offerPrice: acceptance.offerPrice
                }
            })
        ]);
    } else {
        // Create rejection notification to seller
        await Notification.create({
            userId: acceptance.sellerId._id,
            type: 'material_request_rejected',
            title: 'Response Not Selected',
            message: `${req.user.name} did not select your offer for ${acceptance.requestId.itemName}`,
            data: {
                requestId: acceptance.requestId._id,
                acceptanceId: acceptance._id
            }
        });
    }

    res.status(200).json(
        new ApiResponse(200, acceptance, `Response ${action}ed successfully`)
    );
});

// Helper function to get urgency color
const getUrgencyColor = (urgency) => {
    switch (urgency) {
        case 'high': return '#ff4757';
        case 'medium': return '#ffa502';
        case 'low': return '#2ed573';
        default: return '#747d8c';
    }
};

module.exports = {
    createMaterialRequest,
    getMaterialRequests,
    acceptMaterialRequest,
    getUserMaterialRequests,
    getRequestResponses,
    acceptSellerResponse
};
