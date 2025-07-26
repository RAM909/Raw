const mongoose = require('mongoose');

const MaterialRequestAcceptanceSchema = new mongoose.Schema({
    requestId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'MaterialRequest',
        required: true
    },
    sellerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    buyerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    offerPrice: {
        type: Number,
        required: true,
        min: 0
    },
    deliveryOffered: {
        type: Boolean,
        default: false
    },
    deliveryFee: {
        type: Number,
        default: 0,
        min: 0
    },
    message: {
        type: String,
        trim: true
    },
    status: {
        type: String,
        enum: ['pending', 'accepted', 'rejected'],
        default: 'pending'
    },
    responseDate: {
        type: Date
    }
}, {timestamps: true});

// Indexes for efficient queries
MaterialRequestAcceptanceSchema.index({ requestId: 1, sellerId: 1 }, { unique: true }); // Prevent duplicate responses
MaterialRequestAcceptanceSchema.index({ buyerId: 1, status: 1 });
MaterialRequestAcceptanceSchema.index({ sellerId: 1, status: 1 });

// Update responseDate when status changes
MaterialRequestAcceptanceSchema.pre('save', function(next) {
    if (this.isModified('status') && this.status !== 'pending') {
        this.responseDate = new Date();
    }
    next();
});

module.exports = mongoose.model('MaterialRequestAcceptance', MaterialRequestAcceptanceSchema);
