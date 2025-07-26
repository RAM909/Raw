const mongoose = require('mongoose');

const SampleSchema = new mongoose.Schema({
    supplierId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    receiverId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    itemName: {
        type: String,
        required: true,
        trim: true
    },
    imageUrl: {
        type: String,
        required: true
    },
    // Store additional product details for comprehensive information
    productDetails: {
        productId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'SupplierListing',
            required: true
        },
        originalPrice: {
            type: Number,
            required: true
        },
        originalQuantityAvailable: {
            type: Number,
            required: true
        },
        supplierLocation: {
            lat: { type: Number, required: true },
            lng: { type: Number, required: true },
            address: { type: String, required: true }
        },
        productDescription: {
            type: String
        },
        deliveryAvailable: {
            type: Boolean,
            default: false
        },
        deliveryFee: {
            type: Number,
            default: 0
        }
    },
    category: {
        type: String,
        required: true,
        enum: ['vegetables', 'fruits', 'spices', 'sauces', 'containers', 'grains', 'dairy', 'meat', 'other']
    },
    type: {
        type: String,
        required: true,
        enum: ['raw', 'half-baked', 'complete']
    },
    quantity: {
        type: Number,
        required: true,
        min: 0
    },
    unit: {
        type: String,
        required: true,
        enum: ['kg', 'liters', 'pieces', 'grams', 'ml', 'dozens', 'packets']
    },
    deliveryOrPickup: {
        type: String,
        enum: ['delivery', 'pickup'],
        required: true
    },
    deliveryAddress: {
        type: String
    },
    pickupAddress: {
        type: String
    },
    notes: {
        type: String,
        trim: true
    },
    dateGiven: {
        type: Date,
        default: Date.now
    },
    expectedDeliveryDate: {
        type: Date
    },
    actualDeliveryDate: {
        type: Date
    },
    status: {
        type: String,
        enum: ['pending', 'delivered', 'received', 'reviewed'],
        default: 'pending'
    },
    isReviewed: {
        type: Boolean,
        default: false
    },
    reviewId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Review'
    },
    exchangeCode: {
        type: String,
        unique: true,
        sparse: true
    }
}, {timestamps: true});

// Generate unique exchange code for sample delivery
SampleSchema.pre('save', function(next) {
    if (this.status === 'delivered' && !this.exchangeCode) {
        this.exchangeCode = Math.random().toString(36).substr(2, 6).toUpperCase();
    }
    next();
});

// Middleware to prevent user access if they have unreviewed samples
SampleSchema.statics.hasUnreviewedSamples = async function(userId) {
    const unreviewed = await this.findOne({ 
        receiverId: userId, 
        status: 'received',
        isReviewed: false 
    });
    return !!unreviewed;
};

// Check if user is eligible for one-click sample requests
SampleSchema.statics.canMakeOneClickRequest = async function(userId, productId) {
    // Check for existing active requests
    const existingRequest = await this.findOne({
        'productDetails.productId': productId,
        receiverId: userId,
        status: { $in: ['pending', 'delivered', 'received'] }
    });

    if (existingRequest) {
        return {
            canRequest: false,
            reason: 'You already have an active sample request for this product',
            existingRequest
        };
    }

    // Check daily limit
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todaysRequests = await this.countDocuments({
        receiverId: userId,
        createdAt: { $gte: today, $lt: tomorrow }
    });

    if (todaysRequests >= 5) {
        return {
            canRequest: false,
            reason: 'Daily sample request limit reached (5 requests per day)',
            requestsToday: todaysRequests
        };
    }

    return {
        canRequest: true,
        reason: 'You can request a sample for this product',
        requestsToday: todaysRequests
    };
};

// Indexes
SampleSchema.index({ supplierId: 1, status: 1 });
SampleSchema.index({ receiverId: 1, isReviewed: 1 });
SampleSchema.index({ status: 1, dateGiven: -1 });
SampleSchema.index({ 'productDetails.productId': 1, receiverId: 1, status: 1 }); // For checking eligibility
SampleSchema.index({ receiverId: 1, createdAt: -1 }); // For daily limits and activity tracking

module.exports = mongoose.model('Sample', SampleSchema);
