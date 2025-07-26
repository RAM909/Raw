const Sample = require('../models/Sample.model');
const User = require('../models/User.model');
const SupplierListing = require('../models/SupplierListing.model');
const uploadOnCloudinary = require('../utils/cloudinary');
const asyncHandler = require('../utils/asynchandler');
const ApiResponse = require('../utils/apiResponse');
const ApiError = require('../utils/apiError');

// One-click sample request (minimal user input required)
const requestSampleOneClick = asyncHandler(async (req, res) => {
    const { productId } = req.body;

    if (!productId) {
        throw new ApiError(400, 'Product ID is required');
    }

    // Get product with supplier info
    const product = await SupplierListing.findOne({ 
        _id: productId, 
        isActive: true 
    }).populate('userId', 'name username isSupplier address');
    
    if (!product) {
        throw new ApiError(404, 'Product not found or not available');
    }

    const supplierId = product.userId._id;

    // Check eligibility first
    const existingProductRequest = await Sample.findOne({
        'productDetails.productId': productId,
        receiverId: req.user._id,
        status: { $in: ['pending', 'delivered', 'received'] }
    });

    if (existingProductRequest) {
        throw new ApiError(400, 'You already have an active sample request for this product');
    }

    // Get user's address for auto-delivery
    const user = await User.findById(req.user._id).select('address');
    let deliveryAddress = '';
    
    if (user.address && user.address.street) {
        deliveryAddress = `${user.address.street}, ${user.address.city}, ${user.address.state} - ${user.address.pincode}`;
    } else {
        throw new ApiError(400, 'Please update your profile address before requesting samples');
    }

    // Auto-calculate sample details
    const sampleQuantity = 1; // Standard sample size
    const expectedDeliveryDate = new Date();
    expectedDeliveryDate.setDate(expectedDeliveryDate.getDate() + 5); // 5 days delivery

    // Create sample request with full automation
    const sampleRequest = new Sample({
        supplierId,
        receiverId: req.user._id,
        itemName: product.itemName,
        imageUrl: product.imageUrl,
        category: product.category,
        type: product.type,
        quantity: sampleQuantity,
        unit: product.unit || 'pieces',
        deliveryOrPickup: 'delivery',
        deliveryAddress,
        notes: `One-click sample request for ${product.itemName}`,
        expectedDeliveryDate,
        productDetails: {
            productId: product._id,
            originalPrice: product.pricePerUnit,
            originalQuantityAvailable: product.quantityAvailable,
            supplierLocation: product.location,
            productDescription: product.description,
            deliveryAvailable: product.deliveryAvailable,
            deliveryFee: product.deliveryFee
        }
    });

    await sampleRequest.save();

    // Populate response data
    await sampleRequest.populate([
        { 
            path: 'supplierId', 
            select: 'name username rating trustScore'
        },
        { 
            path: 'receiverId', 
            select: 'name username'
        }
    ]);

    // Update user statistics
    await User.findByIdAndUpdate(req.user._id, { 
        $inc: { samplesReceived: 1 } 
    });

    res.status(201).json(
        new ApiResponse(201, sampleRequest, 'Sample request created successfully! Check your sample dashboard for updates.')
    );
});

// Request a sample from a supplier (Simplified one-click process)
const requestSample = asyncHandler(async (req, res) => {
    const {
        productId,
        deliveryOrPickup = 'delivery', // Default to delivery
        deliveryAddress,
        pickupAddress,
        notes
    } = req.body;

    // Only productId is required - everything else auto-populated or has defaults
    if (!productId) {
        throw new ApiError(400, 'Product ID is required');
    }

    // Get product and auto-extract supplier info
    const product = await SupplierListing.findOne({ 
        _id: productId, 
        isActive: true 
    }).populate('userId', 'name username isSupplier address');
    
    if (!product) {
        throw new ApiError(404, 'Product not found or not available');
    }

    // Auto-extract supplier ID from product
    const supplierId = product.userId._id;

    // Verify supplier
    if (!product.userId.isSupplier) {
        throw new ApiError(404, 'Product owner is not a valid supplier');
    }

    // Check if user already has a sample request for this specific product
    const existingProductRequest = await Sample.findOne({
        'productDetails.productId': productId,
        receiverId: req.user._id,
        status: { $in: ['pending', 'delivered', 'received'] } // Exclude reviewed to allow new requests after review
    });

    if (existingProductRequest) {
        throw new ApiError(400, 'You already have an active sample request for this product. Please wait for the current request to be completed before requesting another sample.');
    }

    // Check if user already has a pending sample request from this supplier (general check)
    const existingSupplierRequest = await Sample.findOne({
        supplierId,
        receiverId: req.user._id,
        status: { $in: ['pending', 'delivered'] }
    });

    if (existingSupplierRequest && existingSupplierRequest.productDetails.productId.toString() !== productId) {
        throw new ApiError(400, 'You already have a pending sample request from this supplier. Please complete the current request before requesting another sample.');
    }

    // Smart address handling - auto-use user's address if not provided
    let finalDeliveryAddress = deliveryAddress;
    let finalPickupAddress = pickupAddress;

    if (deliveryOrPickup === 'delivery' && !deliveryAddress) {
        // Auto-use user's address for delivery
        const user = await User.findById(req.user._id).select('address');
        if (user.address && user.address.street) {
            finalDeliveryAddress = `${user.address.street}, ${user.address.city}, ${user.address.state} - ${user.address.pincode}`;
        } else {
            throw new ApiError(400, 'Delivery address required. Please update your profile address or provide delivery address.');
        }
    }
    
    if (deliveryOrPickup === 'pickup' && !pickupAddress) {
        // Auto-use supplier's address for pickup
        if (product.location && product.location.address) {
            finalPickupAddress = product.location.address;
        } else {
            throw new ApiError(400, 'Pickup address not available for this product');
        }
    }

    // Auto-calculate sample quantity (default: small sample)
    const sampleQuantity = Math.min(1, product.quantityAvailable); // 1 unit or available quantity
    const sampleUnit = product.unit || 'pieces'; // Use product's unit

    // Auto-calculate expected delivery (3-5 business days)
    const expectedDeliveryDate = new Date();
    expectedDeliveryDate.setDate(expectedDeliveryDate.getDate() + (deliveryOrPickup === 'delivery' ? 5 : 3));

    // Create sample request with full automation
    const sampleRequest = new Sample({
        supplierId,
        receiverId: req.user._id,
        itemName: product.itemName,
        imageUrl: product.imageUrl,
        category: product.category,
        type: product.type,
        quantity: sampleQuantity,
        unit: sampleUnit,
        deliveryOrPickup,
        deliveryAddress: finalDeliveryAddress,
        pickupAddress: finalPickupAddress,
        notes: notes || `Sample request for ${product.itemName}`,
        expectedDeliveryDate,
        // Store complete product snapshot for history
        productDetails: {
            productId: product._id,
            originalPrice: product.pricePerUnit,
            originalQuantityAvailable: product.quantityAvailable,
            supplierLocation: product.location,
            productDescription: product.description,
            deliveryAvailable: product.deliveryAvailable,
            deliveryFee: product.deliveryFee
        }
    });

    await sampleRequest.save();

    // Populate the saved request with comprehensive user and product details
    await sampleRequest.populate([
        { 
            path: 'supplierId', 
            select: 'name username fullname phone email rating trustScore ordersFulfilled samplesGiven'
        },
        { 
            path: 'receiverId', 
            select: 'name username fullname phone email rating trustScore samplesReceived'
        }
    ]);

    // Update user statistics
    await User.findByIdAndUpdate(req.user._id, { 
        $inc: { samplesReceived: 1 } 
    });

    res.status(201).json(
        new ApiResponse(201, sampleRequest, 'Sample request created successfully')
    );
});

// Get all sample requests for a supplier (incoming requests)
const getIncomingSampleRequests = asyncHandler(async (req, res) => {
    const { page = 1, limit = 10, status } = req.query;

    // Check if user is a supplier
    if (!req.user.isSupplier) {
        throw new ApiError(403, 'Only suppliers can view incoming sample requests');
    }

    const filter = { supplierId: req.user._id };
    if (status) filter.status = status;

    const skip = (page - 1) * limit;

    const sampleRequests = await Sample.find(filter)
        .populate('receiverId', 'name username fullname phone email rating trustScore')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit));

    const total = await Sample.countDocuments(filter);

    res.status(200).json(
        new ApiResponse(200, {
            requests: sampleRequests,
            pagination: {
                current: Number(page),
                pages: Math.ceil(total / limit),
                total,
                hasNext: page < Math.ceil(total / limit),
                hasPrev: page > 1
            }
        }, 'Incoming sample requests fetched successfully')
    );
});

// Get all sample requests made by user (outgoing requests)
const getOutgoingSampleRequests = asyncHandler(async (req, res) => {
    const { page = 1, limit = 10, status } = req.query;

    const filter = { receiverId: req.user._id };
    if (status) filter.status = status;

    const skip = (page - 1) * limit;

    const sampleRequests = await Sample.find(filter)
        .populate('supplierId', 'name username fullname phone email rating trustScore')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit));

    const total = await Sample.countDocuments(filter);

    res.status(200).json(
        new ApiResponse(200, {
            requests: sampleRequests,
            pagination: {
                current: Number(page),
                pages: Math.ceil(total / limit),
                total,
                hasNext: page < Math.ceil(total / limit),
                hasPrev: page > 1
            }
        }, 'Outgoing sample requests fetched successfully')
    );
});

// Accept/Reject a sample request (supplier only)
const updateSampleRequestStatus = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { action, notes } = req.body; // action: 'accept' or 'reject'

    if (!['accept', 'reject'].includes(action)) {
        throw new ApiError(400, 'Invalid action. Must be accept or reject');
    }

    const sampleRequest = await Sample.findById(id);
    if (!sampleRequest) {
        throw new ApiError(404, 'Sample request not found');
    }

    // Check if current user is the supplier for this request
    if (sampleRequest.supplierId.toString() !== req.user._id) {
        throw new ApiError(403, 'You can only update your own sample requests');
    }

    if (sampleRequest.status !== 'pending') {
        throw new ApiError(400, 'Sample request has already been processed');
    }

    if (action === 'accept') {
        sampleRequest.status = 'delivered';
        sampleRequest.actualDeliveryDate = new Date();
        
        // Update supplier statistics
        await User.findByIdAndUpdate(req.user._id, { 
            $inc: { samplesGiven: 1 } 
        });
    } else {
        // For rejection, we can either delete or mark as rejected
        await Sample.findByIdAndDelete(id);
        return res.status(200).json(
            new ApiResponse(200, null, 'Sample request rejected and removed')
        );
    }

    if (notes) {
        sampleRequest.notes = notes;
    }

    await sampleRequest.save();
    await sampleRequest.populate([
        { path: 'supplierId', select: 'name username fullname phone email' },
        { path: 'receiverId', select: 'name username fullname phone email' }
    ]);

    res.status(200).json(
        new ApiResponse(200, sampleRequest, `Sample request ${action}ed successfully`)
    );
});

// Mark sample as received (receiver only)
const markSampleAsReceived = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { exchangeCode } = req.body;

    const sampleRequest = await Sample.findById(id);
    if (!sampleRequest) {
        throw new ApiError(404, 'Sample request not found');
    }

    // Check if current user is the receiver
    if (sampleRequest.receiverId.toString() !== req.user._id) {
        throw new ApiError(403, 'You can only mark your own sample requests as received');
    }

    if (sampleRequest.status !== 'delivered') {
        throw new ApiError(400, 'Sample must be delivered before marking as received');
    }

    // Verify exchange code if provided
    if (exchangeCode && sampleRequest.exchangeCode !== exchangeCode) {
        throw new ApiError(400, 'Invalid exchange code');
    }

    sampleRequest.status = 'received';
    await sampleRequest.save();

    await sampleRequest.populate([
        { path: 'supplierId', select: 'name username fullname phone email' },
        { path: 'receiverId', select: 'name username fullname phone email' }
    ]);

    res.status(200).json(
        new ApiResponse(200, sampleRequest, 'Sample marked as received successfully')
    );
});

// Get sample activity dashboard
const getSampleDashboard = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    // Get counts for different statuses
    const [
        pendingRequests,
        deliveredSamples,
        receivedSamples,
        reviewedSamples,
        incomingPending,
        givenSamples
    ] = await Promise.all([
        Sample.countDocuments({ receiverId: userId, status: 'pending' }),
        Sample.countDocuments({ receiverId: userId, status: 'delivered' }),
        Sample.countDocuments({ receiverId: userId, status: 'received' }),
        Sample.countDocuments({ receiverId: userId, status: 'reviewed' }),
        Sample.countDocuments({ supplierId: userId, status: 'pending' }),
        Sample.countDocuments({ supplierId: userId, status: { $in: ['delivered', 'received', 'reviewed'] } })
    ]);

    // Get recent activity (last 10 samples)
    const recentActivity = await Sample.find({
        $or: [
            { receiverId: userId },
            { supplierId: userId }
        ]
    })
    .populate('supplierId', 'name username')
    .populate('receiverId', 'name username')
    .sort({ updatedAt: -1 })
    .limit(10);

    // Get top categories requested/supplied
    const topCategories = await Sample.aggregate([
        {
            $match: {
                $or: [
                    { receiverId: userId },
                    { supplierId: userId }
                ]
            }
        },
        {
            $group: {
                _id: '$category',
                count: { $sum: 1 }
            }
        },
        {
            $sort: { count: -1 }
        },
        {
            $limit: 5
        }
    ]);

    const dashboardData = {
        statistics: {
            asReceiver: {
                pending: pendingRequests,
                delivered: deliveredSamples,
                received: receivedSamples,
                reviewed: reviewedSamples,
                total: pendingRequests + deliveredSamples + receivedSamples + reviewedSamples
            },
            asSupplier: req.user.isSupplier ? {
                incomingRequests: incomingPending,
                samplesGiven: givenSamples,
                total: incomingPending + givenSamples
            } : null
        },
        recentActivity,
        topCategories
    };

    res.status(200).json(
        new ApiResponse(200, dashboardData, 'Sample dashboard data fetched successfully')
    );
});

// Get sample details by ID
const getSampleDetails = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const sample = await Sample.findById(id)
        .populate('supplierId', 'name username fullname phone email rating trustScore')
        .populate('receiverId', 'name username fullname phone email rating trustScore')
        .populate('reviewId');

    if (!sample) {
        throw new ApiError(404, 'Sample not found');
    }

    // Check if user is involved in this sample
    const isInvolved = sample.supplierId._id.toString() === req.user._id || 
                      sample.receiverId._id.toString() === req.user._id;

    if (!isInvolved) {
        throw new ApiError(403, 'You are not authorized to view this sample');
    }

    res.status(200).json(
        new ApiResponse(200, sample, 'Sample details fetched successfully')
    );
});

// Upload sample image (for updating existing sample)
const uploadSampleImage = asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Check if image file is provided
    if (!req.files || !req.files.image) {
        throw new ApiError(400, 'Image file is required');
    }

    const sample = await Sample.findById(id);
    if (!sample) {
        throw new ApiError(404, 'Sample not found');
    }

    // Check if user is the supplier (only supplier can update images)
    if (sample.supplierId.toString() !== req.user._id) {
        throw new ApiError(403, 'Only the supplier can update sample images');
    }

    const imageFile = req.files.image;

    // Upload image to Cloudinary
    const cloudinaryResponse = await uploadOnCloudinary(imageFile.tempFilePath);
    
    if (!cloudinaryResponse) {
        throw new ApiError(500, 'Failed to upload image to Cloudinary');
    }

    sample.imageUrl = cloudinaryResponse.secure_url;
    await sample.save();

    res.status(200).json(
        new ApiResponse(200, { imageUrl: cloudinaryResponse.secure_url }, 'Sample image updated successfully')
    );
});

// Get samples by category (for analytics)
const getSamplesByCategory = asyncHandler(async (req, res) => {
    const { category } = req.params;
    const { page = 1, limit = 10, type } = req.query;

    const filter = {
        $or: [
            { receiverId: req.user._id },
            { supplierId: req.user._id }
        ],
        category
    };

    if (type) filter.type = type;

    const skip = (page - 1) * limit;

    const samples = await Sample.find(filter)
        .populate('supplierId', 'name username rating trustScore')
        .populate('receiverId', 'name username rating trustScore')
        .populate({
            path: 'productDetails.productId',
            select: 'itemName imageUrl pricePerUnit quantityAvailable isActive'
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit));

    const total = await Sample.countDocuments(filter);

    // Add role information to each sample
    const enhancedSamples = samples.map(sample => {
        const sampleObj = sample.toObject();
        sampleObj.userRole = sample.receiverId._id.toString() === req.user._id ? 'receiver' : 'supplier';
        return sampleObj;
    });

    res.status(200).json(
        new ApiResponse(200, {
            samples: enhancedSamples,
            pagination: {
                current: Number(page),
                pages: Math.ceil(total / limit),
                total
            }
        }, `Samples in ${category} category fetched successfully`)
    );
});

// Get comprehensive sample order history for user profile
const getUserSampleProfile = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { page = 1, limit = 10, status, type } = req.query;

    // Build filter
    const filter = {
        $or: [
            { receiverId: userId },
            { supplierId: userId }
        ]
    };

    if (status) filter.status = status;
    if (type) filter.type = type;

    const skip = (page - 1) * limit;

    // Get samples with comprehensive details
    const samples = await Sample.find(filter)
        .populate({
            path: 'supplierId',
            select: 'name username fullname phone email rating trustScore ordersFulfilled samplesGiven address'
        })
        .populate({
            path: 'receiverId', 
            select: 'name username fullname phone email rating trustScore samplesReceived address'
        })
        .populate({
            path: 'productDetails.productId',
            select: 'itemName imageUrl category type pricePerUnit quantityAvailable location isActive'
        })
        .populate('reviewId')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit));

    const total = await Sample.countDocuments(filter);

    // Enhance samples with role information and additional details
    const enhancedSamples = samples.map(sample => {
        const sampleObj = sample.toObject();
        
        // Determine user's role in this sample
        const userRole = sample.receiverId._id.toString() === userId ? 'receiver' : 'supplier';
        
        // Add role-specific information
        sampleObj.userRole = userRole;
        sampleObj.counterparty = userRole === 'receiver' ? sampleObj.supplierId : sampleObj.receiverId;
        
        // Add computed fields
        sampleObj.isCompleted = ['received', 'reviewed'].includes(sample.status);
        sampleObj.daysActive = Math.floor((new Date() - sample.createdAt) / (1000 * 60 * 60 * 24));
        
        // Add delivery estimation
        if (sample.expectedDeliveryDate) {
            const daysUntilDelivery = Math.floor((sample.expectedDeliveryDate - new Date()) / (1000 * 60 * 60 * 24));
            sampleObj.deliveryStatus = daysUntilDelivery > 0 ? `${daysUntilDelivery} days remaining` : 
                                     daysUntilDelivery === 0 ? 'Due today' : 
                                     `${Math.abs(daysUntilDelivery)} days overdue`;
        }

        return sampleObj;
    });

    // Get summary statistics for the profile
    const [
        totalAsReceiver,
        totalAsSupplier,
        completedAsReceiver,
        completedAsSupplier,
        pendingAsReceiver,
        pendingAsSupplier
    ] = await Promise.all([
        Sample.countDocuments({ receiverId: userId }),
        Sample.countDocuments({ supplierId: userId }),
        Sample.countDocuments({ receiverId: userId, status: { $in: ['received', 'reviewed'] } }),
        Sample.countDocuments({ supplierId: userId, status: { $in: ['received', 'reviewed'] } }),
        Sample.countDocuments({ receiverId: userId, status: { $in: ['pending', 'delivered'] } }),
        Sample.countDocuments({ supplierId: userId, status: { $in: ['pending', 'delivered'] } })
    ]);

    const profileSummary = {
        asReceiver: {
            total: totalAsReceiver,
            completed: completedAsReceiver,
            pending: pendingAsReceiver,
            completionRate: totalAsReceiver > 0 ? ((completedAsReceiver / totalAsReceiver) * 100).toFixed(1) : 0
        },
        asSupplier: {
            total: totalAsSupplier,
            completed: completedAsSupplier,
            pending: pendingAsSupplier,
            fulfillmentRate: totalAsSupplier > 0 ? ((completedAsSupplier / totalAsSupplier) * 100).toFixed(1) : 0
        },
        overall: {
            totalSamples: totalAsReceiver + totalAsSupplier,
            totalCompleted: completedAsReceiver + completedAsSupplier
        }
    };

    res.status(200).json(
        new ApiResponse(200, {
            samples: enhancedSamples,
            summary: profileSummary,
            pagination: {
                current: Number(page),
                pages: Math.ceil(total / limit),
                total,
                hasNext: page < Math.ceil(total / limit),
                hasPrev: page > 1
            }
        }, 'User sample profile fetched successfully')
    );
});

// Get sample order details with product information
const getSampleOrderDetails = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const sample = await Sample.findById(id)
        .populate({
            path: 'supplierId',
            select: 'name username fullname phone email rating trustScore ordersFulfilled samplesGiven address'
        })
        .populate({
            path: 'receiverId',
            select: 'name username fullname phone email rating trustScore samplesReceived address'
        })
        .populate({
            path: 'productDetails.productId',
            select: 'itemName imageUrl category type pricePerUnit quantityAvailable location description isActive deliveryAvailable deliveryFee'
        })
        .populate('reviewId');

    if (!sample) {
        throw new ApiError(404, 'Sample not found');
    }

    // Check if user is involved in this sample
    const isInvolved = sample.supplierId._id.toString() === req.user._id || 
                      sample.receiverId._id.toString() === req.user._id;

    if (!isInvolved) {
        throw new ApiError(403, 'You are not authorized to view this sample');
    }

    // Enhance sample with additional computed information
    const sampleObj = sample.toObject();
    
    // Determine user's role
    const userRole = sample.receiverId._id.toString() === req.user._id ? 'receiver' : 'supplier';
    sampleObj.userRole = userRole;
    sampleObj.counterparty = userRole === 'receiver' ? sampleObj.supplierId : sampleObj.receiverId;
    
    // Add timeline information
    const timeline = [
        {
            status: 'requested',
            date: sample.createdAt,
            description: `Sample requested by ${sample.receiverId.name}`,
            completed: true
        }
    ];

    if (sample.status !== 'pending') {
        timeline.push({
            status: 'accepted',
            date: sample.updatedAt,
            description: `Sample accepted by ${sample.supplierId.name}`,
            completed: true
        });
    }

    if (sample.actualDeliveryDate) {
        timeline.push({
            status: 'delivered',
            date: sample.actualDeliveryDate,
            description: `Sample delivered`,
            completed: sample.status !== 'delivered'
        });
    }

    if (sample.status === 'received') {
        timeline.push({
            status: 'received',
            date: sample.updatedAt,
            description: `Sample received by ${sample.receiverId.name}`,
            completed: true
        });
    }

    if (sample.status === 'reviewed') {
        timeline.push({
            status: 'reviewed',
            date: sample.updatedAt,
            description: `Sample reviewed`,
            completed: true
        });
    }

    sampleObj.timeline = timeline;
    
    // Add distance calculation if both addresses are available
    if (sample.productDetails?.supplierLocation && (sample.deliveryAddress || sample.pickupAddress)) {
        // You can integrate with a distance calculation service here
        sampleObj.estimatedDistance = 'Available on request';
    }

    res.status(200).json(
        new ApiResponse(200, sampleObj, 'Sample order details fetched successfully')
    );
});

// Check if user can request a sample for a specific product
const checkSampleEligibility = asyncHandler(async (req, res) => {
    const { productId, supplierId } = req.query;

    if (!productId || !supplierId) {
        throw new ApiError(400, 'Product ID and Supplier ID are required');
    }

    // Check if product exists and is active
    const product = await SupplierListing.findOne({ 
        _id: productId, 
        userId: supplierId, 
        isActive: true 
    });

    if (!product) {
        return res.status(200).json(
            new ApiResponse(200, {
                eligible: false,
                reason: 'Product not found or not available',
                canRequest: false
            }, 'Sample eligibility checked')
        );
    }

    // Check if user already has a sample request for this specific product
    const existingProductRequest = await Sample.findOne({
        'productDetails.productId': productId,
        receiverId: req.user._id,
        status: { $in: ['pending', 'delivered', 'received'] }
    });

    if (existingProductRequest) {
        return res.status(200).json(
            new ApiResponse(200, {
                eligible: false,
                reason: 'You already have an active sample request for this product',
                canRequest: false,
                existingRequest: {
                    id: existingProductRequest._id,
                    status: existingProductRequest.status,
                    createdAt: existingProductRequest.createdAt,
                    expectedDeliveryDate: existingProductRequest.expectedDeliveryDate
                }
            }, 'Sample eligibility checked')
        );
    }

    // Check if user has pending requests from this supplier for other products
    const existingSupplierRequest = await Sample.findOne({
        supplierId,
        receiverId: req.user._id,
        status: { $in: ['pending', 'delivered'] }
    });

    if (existingSupplierRequest) {
        return res.status(200).json(
            new ApiResponse(200, {
                eligible: false,
                reason: 'You have a pending sample request from this supplier for another product',
                canRequest: false,
                existingRequest: {
                    id: existingSupplierRequest._id,
                    itemName: existingSupplierRequest.itemName,
                    status: existingSupplierRequest.status,
                    createdAt: existingSupplierRequest.createdAt
                }
            }, 'Sample eligibility checked')
        );
    }

    // Check if user has reached daily sample request limit (optional protection)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todaysRequests = await Sample.countDocuments({
        receiverId: req.user._id,
        createdAt: { $gte: today, $lt: tomorrow }
    });

    const dailyLimit = 5; // Maximum 5 sample requests per day
    if (todaysRequests >= dailyLimit) {
        return res.status(200).json(
            new ApiResponse(200, {
                eligible: false,
                reason: `Daily sample request limit reached (${dailyLimit} requests per day)`,
                canRequest: false,
                requestsToday: todaysRequests
            }, 'Sample eligibility checked')
        );
    }

    // User is eligible to request sample
    res.status(200).json(
        new ApiResponse(200, {
            eligible: true,
            reason: 'You can request a sample for this product',
            canRequest: true,
            product: {
                id: product._id,
                name: product.itemName,
                category: product.category,
                type: product.type,
                price: product.pricePerUnit,
                unit: product.unit
            },
            requestsToday: todaysRequests,
            dailyLimit: dailyLimit
        }, 'Sample eligibility checked')
    );
});

// Get user's sample request history for a specific product
const getProductSampleHistory = asyncHandler(async (req, res) => {
    const { productId } = req.params;
    const { page = 1, limit = 10 } = req.query;

    const skip = (page - 1) * limit;

    // Get all sample requests for this product by the user
    const sampleHistory = await Sample.find({
        'productDetails.productId': productId,
        receiverId: req.user._id
    })
    .populate('supplierId', 'name username rating trustScore')
    .populate({
        path: 'productDetails.productId',
        select: 'itemName imageUrl category type pricePerUnit quantityAvailable isActive'
    })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(Number(limit));

    const total = await Sample.countDocuments({
        'productDetails.productId': productId,
        receiverId: req.user._id
    });

    // Add additional information to each sample
    const enhancedHistory = sampleHistory.map(sample => {
        const sampleObj = sample.toObject();
        sampleObj.daysAgo = Math.floor((new Date() - sample.createdAt) / (1000 * 60 * 60 * 24));
        sampleObj.canRequestAgain = sample.status === 'reviewed';
        sampleObj.statusColor = getStatusColor(sample.status);
        return sampleObj;
    });

    res.status(200).json(
        new ApiResponse(200, {
            history: enhancedHistory,
            summary: {
                totalRequests: total,
                canRequestNew: !sampleHistory.some(s => ['pending', 'delivered', 'received'].includes(s.status))
            },
            pagination: {
                current: Number(page),
                pages: Math.ceil(total / limit),
                total
            }
        }, 'Product sample history fetched successfully')
    );
});

module.exports = {
    requestSample,
    requestSampleOneClick,
    getIncomingSampleRequests,
    getOutgoingSampleRequests,
    updateSampleRequestStatus,
    markSampleAsReceived,
    getSampleDashboard,
    getSampleDetails,
    uploadSampleImage,
    getSamplesByCategory,
    getUserSampleProfile,
    getSampleOrderDetails,
    checkSampleEligibility,
    getProductSampleHistory
};
