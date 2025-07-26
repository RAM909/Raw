const Sample = require('../models/Sample.model');
const User = require('../models/User.model');
const SupplierListing = require('../models/SupplierListing.model');
const asyncHandler = require('../utils/asynchandler');
const ApiResponse = require('../utils/apiResponse');
const ApiError = require('../utils/apiError');

// Get comprehensive user analytics
const getUserAnalytics = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { timeframe = '30' } = req.query; // days
    
    const daysAgo = new Date();
    daysAgo.setDate(daysAgo.getDate() - parseInt(timeframe));

    // Sample activity analytics
    const sampleStats = await Sample.aggregate([
        {
            $match: {
                $or: [
                    { receiverId: userId },
                    { supplierId: userId }
                ],
                createdAt: { $gte: daysAgo }
            }
        },
        {
            $group: {
                _id: null,
                totalSamples: { $sum: 1 },
                asReceiver: {
                    $sum: {
                        $cond: [{ $eq: ['$receiverId', userId] }, 1, 0]
                    }
                },
                asSupplier: {
                    $sum: {
                        $cond: [{ $eq: ['$supplierId', userId] }, 1, 0]
                    }
                },
                delivered: {
                    $sum: {
                        $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0]
                    }
                },
                received: {
                    $sum: {
                        $cond: [{ $eq: ['$status', 'received'] }, 1, 0]
                    }
                },
                reviewed: {
                    $sum: {
                        $cond: [{ $eq: ['$status', 'reviewed'] }, 1, 0]
                    }
                }
            }
        }
    ]);

    // Daily activity over the timeframe
    const dailyActivity = await Sample.aggregate([
        {
            $match: {
                $or: [
                    { receiverId: userId },
                    { supplierId: userId }
                ],
                createdAt: { $gte: daysAgo }
            }
        },
        {
            $group: {
                _id: {
                    $dateToString: {
                        format: '%Y-%m-%d',
                        date: '$createdAt'
                    }
                },
                count: { $sum: 1 },
                received: {
                    $sum: {
                        $cond: [{ $eq: ['$receiverId', userId] }, 1, 0]
                    }
                },
                supplied: {
                    $sum: {
                        $cond: [{ $eq: ['$supplierId', userId] }, 1, 0]
                    }
                }
            }
        },
        {
            $sort: { _id: 1 }
        }
    ]);

    // Category distribution
    const categoryDistribution = await Sample.aggregate([
        {
            $match: {
                $or: [
                    { receiverId: userId },
                    { supplierId: userId }
                ],
                createdAt: { $gte: daysAgo }
            }
        },
        {
            $group: {
                _id: '$category',
                count: { $sum: 1 },
                asReceiver: {
                    $sum: {
                        $cond: [{ $eq: ['$receiverId', userId] }, 1, 0]
                    }
                },
                asSupplier: {
                    $sum: {
                        $cond: [{ $eq: ['$supplierId', userId] }, 1, 0]
                    }
                }
            }
        },
        {
            $sort: { count: -1 }
        }
    ]);

    // Product listings analytics (if user is a supplier)
    let productStats = null;
    if (req.user.isSupplier) {
        const productAnalytics = await SupplierListing.aggregate([
            {
                $match: {
                    userId: userId,
                    createdAt: { $gte: daysAgo }
                }
            },
            {
                $group: {
                    _id: null,
                    totalProducts: { $sum: 1 },
                    activeProducts: {
                        $sum: {
                            $cond: ['$isActive', 1, 0]
                        }
                    },
                    averagePrice: { $avg: '$pricePerUnit' },
                    totalQuantity: { $sum: '$quantityAvailable' }
                }
            }
        ]);

        productStats = productAnalytics[0] || {
            totalProducts: 0,
            activeProducts: 0,
            averagePrice: 0,
            totalQuantity: 0
        };
    }

    // Recent connections (users you've interacted with)
    const recentConnections = await Sample.aggregate([
        {
            $match: {
                $or: [
                    { receiverId: userId },
                    { supplierId: userId }
                ],
                createdAt: { $gte: daysAgo }
            }
        },
        {
            $group: {
                _id: {
                    $cond: [
                        { $eq: ['$receiverId', userId] },
                        '$supplierId',
                        '$receiverId'
                    ]
                },
                interactions: { $sum: 1 },
                lastInteraction: { $max: '$createdAt' },
                relationship: {
                    $first: {
                        $cond: [
                            { $eq: ['$receiverId', userId] },
                            'supplier',
                            'receiver'
                        ]
                    }
                }
            }
        },
        {
            $lookup: {
                from: 'users',
                localField: '_id',
                foreignField: '_id',
                as: 'userInfo'
            }
        },
        {
            $unwind: '$userInfo'
        },
        {
            $project: {
                _id: 1,
                interactions: 1,
                lastInteraction: 1,
                relationship: 1,
                name: '$userInfo.name',
                username: '$userInfo.username',
                rating: '$userInfo.rating',
                trustScore: '$userInfo.trustScore'
            }
        },
        {
            $sort: { interactions: -1, lastInteraction: -1 }
        },
        {
            $limit: 10
        }
    ]);

    const analytics = {
        timeframe: parseInt(timeframe),
        sampleActivity: sampleStats[0] || {
            totalSamples: 0,
            asReceiver: 0,
            asSupplier: 0,
            delivered: 0,
            received: 0,
            reviewed: 0
        },
        dailyActivity,
        categoryDistribution,
        productStats,
        recentConnections,
        userStats: {
            rating: req.user.rating,
            trustScore: req.user.trustScore,
            ordersFulfilled: req.user.ordersFulfilled,
            samplesGiven: req.user.samplesGiven,
            samplesReceived: req.user.samplesReceived
        }
    };

    res.status(200).json(
        new ApiResponse(200, analytics, 'User analytics fetched successfully')
    );
});

// Get platform-wide statistics (for admin or general stats)
const getPlatformStats = asyncHandler(async (req, res) => {
    const { timeframe = '30' } = req.query;
    
    const daysAgo = new Date();
    daysAgo.setDate(daysAgo.getDate() - parseInt(timeframe));

    const [
        totalUsers,
        totalSuppliers,
        totalProducts,
        totalSamples,
        activeSamples,
        completedSamples
    ] = await Promise.all([
        User.countDocuments(),
        User.countDocuments({ isSupplier: true }),
        SupplierListing.countDocuments({ isActive: true }),
        Sample.countDocuments({ createdAt: { $gte: daysAgo } }),
        Sample.countDocuments({ 
            status: { $in: ['pending', 'delivered'] },
            createdAt: { $gte: daysAgo }
        }),
        Sample.countDocuments({ 
            status: { $in: ['received', 'reviewed'] },
            createdAt: { $gte: daysAgo }
        })
    ]);

    // Top categories by activity
    const topCategories = await Sample.aggregate([
        {
            $match: {
                createdAt: { $gte: daysAgo }
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

    // Most active suppliers
    const topSuppliers = await Sample.aggregate([
        {
            $match: {
                status: { $ne: 'pending' },
                createdAt: { $gte: daysAgo }
            }
        },
        {
            $group: {
                _id: '$supplierId',
                samplesGiven: { $sum: 1 }
            }
        },
        {
            $lookup: {
                from: 'users',
                localField: '_id',
                foreignField: '_id',
                as: 'supplier'
            }
        },
        {
            $unwind: '$supplier'
        },
        {
            $project: {
                _id: 1,
                samplesGiven: 1,
                name: '$supplier.name',
                username: '$supplier.username',
                rating: '$supplier.rating'
            }
        },
        {
            $sort: { samplesGiven: -1 }
        },
        {
            $limit: 10
        }
    ]);

    const platformStats = {
        timeframe: parseInt(timeframe),
        overview: {
            totalUsers,
            totalSuppliers,
            totalProducts,
            totalSamples,
            activeSamples,
            completedSamples,
            completionRate: totalSamples > 0 ? (completedSamples / totalSamples * 100).toFixed(2) : 0
        },
        topCategories,
        topSuppliers
    };

    res.status(200).json(
        new ApiResponse(200, platformStats, 'Platform statistics fetched successfully')
    );
});

// Get user performance metrics
const getUserPerformanceMetrics = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    // Calculate completion rate
    const totalSamplesAsReceiver = await Sample.countDocuments({ receiverId: userId });
    const reviewedSamples = await Sample.countDocuments({ 
        receiverId: userId, 
        status: 'reviewed' 
    });

    // Calculate response time for suppliers
    let avgResponseTime = 0;
    if (req.user.isSupplier) {
        const responseTimeData = await Sample.aggregate([
            {
                $match: {
                    supplierId: userId,
                    status: { $ne: 'pending' }
                }
            },
            {
                $project: {
                    responseTime: {
                        $subtract: ['$updatedAt', '$createdAt']
                    }
                }
            },
            {
                $group: {
                    _id: null,
                    averageResponseTime: { $avg: '$responseTime' }
                }
            }
        ]);

        avgResponseTime = responseTimeData[0]?.averageResponseTime || 0;
        avgResponseTime = Math.round(avgResponseTime / (1000 * 60 * 60)); // Convert to hours
    }

    // Calculate reliability score
    const totalRequestsAsSupplier = await Sample.countDocuments({ supplierId: userId });
    const fulfilledRequests = await Sample.countDocuments({ 
        supplierId: userId, 
        status: { $in: ['delivered', 'received', 'reviewed'] }
    });

    const reliabilityScore = totalRequestsAsSupplier > 0 ? 
        (fulfilledRequests / totalRequestsAsSupplier * 100).toFixed(2) : 100;

    const performance = {
        completionRate: totalSamplesAsReceiver > 0 ? 
            (reviewedSamples / totalSamplesAsReceiver * 100).toFixed(2) : 0,
        reliabilityScore,
        averageResponseTime: avgResponseTime,
        totalInteractions: totalSamplesAsReceiver + totalRequestsAsSupplier,
        currentRating: req.user.rating,
        trustScore: req.user.trustScore
    };

    res.status(200).json(
        new ApiResponse(200, performance, 'User performance metrics fetched successfully')
    );
});

module.exports = {
    getUserAnalytics,
    getPlatformStats,
    getUserPerformanceMetrics
};
