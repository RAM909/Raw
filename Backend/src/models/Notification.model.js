const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    type: {
        type: String,
        required: true,
        enum: [
            'material_request_response',    // Seller responded to buyer's request
            'material_request_sent',        // Confirmation to seller that response was sent
            'material_request_accepted',    // Seller's response was accepted by buyer
            'material_request_rejected',    // Seller's response was rejected by buyer
            'material_request_confirmed',   // Buyer confirmed the deal
            'order_placed',                 // New order notifications
            'order_confirmed',              // Order status updates
            'order_shipped',
            'order_completed',
            'sample_request',               // Sample-related notifications
            'sample_approved',
            'sample_delivered',
            'review_received',              // Review notifications
            'connection_request',           // Social features
            'connection_accepted',
            'system_announcement',          // System-wide announcements
            'payment_received',             // Payment notifications
            'promotion'                     // Promotional notifications
        ]
    },
    title: {
        type: String,
        required: true,
        trim: true
    },
    message: {
        type: String,
        required: true,
        trim: true
    },
    data: {
        type: mongoose.Schema.Types.Mixed, // Store additional data related to the notification
        default: {}
    },
    isRead: {
        type: Boolean,
        default: false
    },
    actionRequired: {
        type: Boolean,
        default: false
    },
    actionUrl: {
        type: String,
        trim: true
    },
    priority: {
        type: String,
        enum: ['low', 'medium', 'high', 'urgent'],
        default: 'medium'
    },
    category: {
        type: String,
        enum: ['order', 'sample', 'material_request', 'social', 'system', 'payment'],
        default: 'system'
    },
    expiresAt: {
        type: Date
    },
    readAt: {
        type: Date
    }
}, {timestamps: true});

// Indexes for efficient queries
NotificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });
NotificationSchema.index({ userId: 1, type: 1 });
NotificationSchema.index({ userId: 1, actionRequired: 1 });
NotificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // Auto-delete expired notifications

// Update readAt when notification is marked as read
NotificationSchema.pre('save', function(next) {
    if (this.isModified('isRead') && this.isRead && !this.readAt) {
        this.readAt = new Date();
    }
    next();
});

// Static method to get user's notification summary
NotificationSchema.statics.getUserNotificationSummary = async function(userId) {
    const summary = await this.aggregate([
        { $match: { userId: new mongoose.Types.ObjectId(userId) } },
        {
            $group: {
                _id: null,
                totalNotifications: { $sum: 1 },
                unreadCount: { $sum: { $cond: ['$isRead', 0, 1] } },
                actionRequiredCount: { $sum: { $cond: ['$actionRequired', 1, 0] } },
                highPriorityCount: { $sum: { $cond: [{ $in: ['$priority', ['high', 'urgent']] }, 1, 0] } }
            }
        }
    ]);

    return summary[0] || {
        totalNotifications: 0,
        unreadCount: 0,
        actionRequiredCount: 0,
        highPriorityCount: 0
    };
};

// Static method to mark all notifications as read
NotificationSchema.statics.markAllAsRead = async function(userId) {
    return await this.updateMany(
        { userId, isRead: false },
        { 
            $set: { 
                isRead: true,
                readAt: new Date()
            }
        }
    );
};

module.exports = mongoose.model('Notification', NotificationSchema);
