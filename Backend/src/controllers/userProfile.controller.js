const User = require("../models/User.model");
const Sample = require("../models/Sample.model");
const Order = require("../models/Order.model");
const Review = require("../models/Review.model");
const SupplierListing = require("../models/SupplierListing.model");
const MaterialRequest = require("../models/MaterialRequest.model");
const Notification = require("../models/Notification.model");
const Negotiation = require("../models/Negotiation.model");
const asyncHandler = require("../utils/asynchandler");
const ApiResponse = require("../utils/apiResponse");
const ApiError = require("../utils/apiError");
const mongoose = require("mongoose");

// Get comprehensive user profile with sample and product information
const getUserCompleteProfile = asyncHandler(async (req, res) => {
  const userId = req.params.userId || req.user._id;

  // Get user details
  const user = await User.findById(userId).select("-password -refresh_token");
  if (!user) {
    throw new ApiError(404, "User not found");
  }

  // Check if requesting user can view this profile
  const isOwnProfile = userId === req.user._id;
  const canViewProfile = isOwnProfile || true; // You can add privacy logic here

  if (!canViewProfile) {
    throw new ApiError(403, "You are not authorized to view this profile");
  }

  // Get comprehensive statistics including orders
  const [
    samplesAsReceiver,
    samplesAsSupplier,
    completedSamplesAsReceiver,
    completedSamplesAsSupplier,
    ordersAsBuyer,
    ordersAsSeller,
    completedOrdersAsBuyer,
    completedOrdersAsSeller,
    avgRatingReceived,
    totalProducts,
    activeProducts,
    reviewsReceived,
    reviewsGiven,
  ] = await Promise.all([
    Sample.countDocuments({ receiverId: userId }),
    Sample.countDocuments({ supplierId: userId }),
    Sample.countDocuments({
      receiverId: userId,
      status: { $in: ["received", "reviewed"] },
    }),
    Sample.countDocuments({
      supplierId: userId,
      status: { $in: ["received", "reviewed"] },
    }),
    Order.countDocuments({ buyerId: userId }),
    Order.countDocuments({ sellerId: userId }),
    Order.countDocuments({ buyerId: userId, status: "completed" }),
    Order.countDocuments({ sellerId: userId, status: "completed" }),
    Sample.aggregate([
      { $match: { supplierId: userId, reviewId: { $exists: true } } },
      {
        $lookup: {
          from: "reviews",
          localField: "reviewId",
          foreignField: "_id",
          as: "review",
        },
      },
      { $unwind: "$review" },
      { $group: { _id: null, avgRating: { $avg: "$review.rating" } } },
    ]),
    user.isSupplier ? SupplierListing.countDocuments({ userId }) : 0,
    user.isSupplier
      ? SupplierListing.countDocuments({ userId, isActive: true })
      : 0,
    Review.countDocuments({ toUserId: userId, isVerified: true }),
    Review.countDocuments({ fromUserId: userId }),
  ]);

  // Get recent sample activity (last 5) with enhanced details
  const recentSampleActivity = await Sample.find({
    $or: [{ receiverId: userId }, { supplierId: userId }],
  })
    .populate("supplierId", "name username rating trustScore")
    .populate("receiverId", "name username rating trustScore")
    .populate({
      path: "productDetails.productId",
      select: "itemName imageUrl category type pricePerUnit quantityAvailable",
    })
    .sort({ createdAt: -1 })
    .limit(5);

  // Get complete sample history grouped by status for profile showcase
  const sampleHistory = await Sample.aggregate([
    {
      $match: {
        $or: [{ receiverId: userId }, { supplierId: userId }],
      },
    },
    {
      $addFields: {
        userRole: {
          $cond: [{ $eq: ["$receiverId", userId] }, "receiver", "supplier"],
        },
        statusPriority: {
          $switch: {
            branches: [
              { case: { $eq: ["$status", "pending"] }, then: 1 },
              { case: { $eq: ["$status", "delivered"] }, then: 2 },
              { case: { $eq: ["$status", "received"] }, then: 3 },
              { case: { $eq: ["$status", "reviewed"] }, then: 4 },
            ],
            default: 5,
          },
        },
      },
    },
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
        samples: {
          $push: {
            _id: "$_id",
            itemName: "$itemName",
            category: "$category",
            type: "$type",
            quantity: "$quantity",
            unit: "$unit",
            userRole: "$userRole",
            createdAt: "$createdAt",
            expectedDeliveryDate: "$expectedDeliveryDate",
            actualDeliveryDate: "$actualDeliveryDate",
            statusPriority: "$statusPriority",
          },
        },
      },
    },
    {
      $sort: { _id: 1 },
    },
  ]);

  // Get user's products if they are a supplier
  let products = [];
  if (user.isSupplier) {
    products = await SupplierListing.find({ userId })
      .sort({ createdAt: -1 })
      .limit(6)
      .select(
        "itemName imageUrl category type pricePerUnit quantityAvailable isActive"
      );
  }

  // Get categories user is most active in
  const topCategories = await Sample.aggregate([
    {
      $match: {
        $or: [{ receiverId: userId }, { supplierId: userId }],
      },
    },
    {
      $group: {
        _id: "$category",
        count: { $sum: 1 },
        asReceiver: {
          $sum: { $cond: [{ $eq: ["$receiverId", userId] }, 1, 0] },
        },
        asSupplier: {
          $sum: { $cond: [{ $eq: ["$supplierId", userId] }, 1, 0] },
        },
      },
    },
    { $sort: { count: -1 } },
    { $limit: 5 },
  ]);

  // Calculate performance metrics
  const completionRate =
    samplesAsReceiver > 0
      ? ((completedSamplesAsReceiver / samplesAsReceiver) * 100).toFixed(1)
      : 0;

  const fulfillmentRate =
    samplesAsSupplier > 0
      ? ((completedSamplesAsSupplier / samplesAsSupplier) * 100).toFixed(1)
      : 0;

  const averageRating =
    avgRatingReceived.length > 0
      ? avgRatingReceived[0].avgRating.toFixed(1)
      : 0;

  const profileData = {
    user: {
      ...user.toObject(),
      profileCompletion: calculateProfileCompletion(user),
    },
    statistics: {
      samples: {
        asReceiver: {
          total: samplesAsReceiver,
          completed: completedSamplesAsReceiver,
          completionRate: parseFloat(completionRate),
        },
        asSupplier: user.isSupplier
          ? {
              total: samplesAsSupplier,
              completed: completedSamplesAsSupplier,
              fulfillmentRate: parseFloat(fulfillmentRate),
            }
          : null,
        overall: {
          total: samplesAsReceiver + samplesAsSupplier,
          completed: completedSamplesAsReceiver + completedSamplesAsSupplier,
        },
      },
      products: user.isSupplier
        ? {
            total: totalProducts,
            active: activeProducts,
            activeRate:
              totalProducts > 0
                ? ((activeProducts / totalProducts) * 100).toFixed(1)
                : 0,
          }
        : null,
      ratings: {
        current: user.rating,
        trustScore: user.trustScore,
        averageReceived: parseFloat(averageRating),
      },
    },
    sampleHistory: {
      byStatus: sampleHistory,
      summary: {
        totalRequests: samplesAsReceiver + samplesAsSupplier,
        activeRequests:
          sampleHistory.find((s) => s._id === "pending")?.count || 0,
        completedRequests:
          (sampleHistory.find((s) => s._id === "received")?.count || 0) +
          (sampleHistory.find((s) => s._id === "reviewed")?.count || 0),
        pendingDeliveries:
          sampleHistory.find((s) => s._id === "delivered")?.count || 0,
      },
    },
    recentActivity: recentSampleActivity.map((sample) => ({
      ...sample.toObject(),
      userRole:
        sample.receiverId._id.toString() === userId ? "receiver" : "supplier",
      counterparty:
        sample.receiverId._id.toString() === userId
          ? sample.supplierId
          : sample.receiverId,
      daysAgo: Math.floor(
        (new Date() - sample.createdAt) / (1000 * 60 * 60 * 24)
      ),
      statusColor: getStatusColor(sample.status),
      nextAction: getNextAction(sample, userId),
    })),
    products: user.isSupplier ? products : null,
    categories: topCategories,
    isOwnProfile,
  };

  res
    .status(200)
    .json(
      new ApiResponse(200, profileData, "User profile fetched successfully")
    );
});

// Helper function to calculate profile completion percentage
const calculateProfileCompletion = (user) => {
  let completion = 0;
  const fields = [
    user.name,
    user.username,
    user.fullname,
    user.phone,
    user.email,
    user.address?.street,
    user.address?.city,
    user.address?.state,
    user.address?.pincode,
  ];

  const completedFields = fields.filter(
    (field) => field && field.trim() !== ""
  ).length;
  completion = (completedFields / fields.length) * 100;

  // Bonus points for verification and activity
  if (user.isEmailVerified) completion += 5;
  if (user.samplesGiven > 0) completion += 5;
  if (user.samplesReceived > 0) completion += 5;

  return Math.min(100, Math.round(completion));
};

// Helper function to get status color for UI
const getStatusColor = (status) => {
  const colors = {
    pending: "#f59e0b", // amber
    delivered: "#3b82f6", // blue
    received: "#10b981", // green
    reviewed: "#6b7280", // gray
  };
  return colors[status] || "#6b7280";
};

// Helper function to get next action for user
const getNextAction = (sample, userId) => {
  const isReceiver = sample.receiverId._id.toString() === userId;
  const isSupplier = sample.supplierId._id.toString() === userId;

  switch (sample.status) {
    case "pending":
      return isSupplier
        ? "Accept or reject request"
        : "Waiting for supplier response";
    case "delivered":
      return isReceiver
        ? "Mark as received"
        : "Waiting for receiver confirmation";
    case "received":
      return isReceiver ? "Write a review" : "Sample delivered successfully";
    case "reviewed":
      return "Process completed";
    default:
      return "No action required";
  }
};

// Get connection suggestions based on sample history
const getConnectionSuggestions = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { limit = 10 } = req.query;

  // Get users the current user has interacted with
  const interactedUsers = await Sample.distinct("supplierId", {
    receiverId: userId,
  });
  const interactedUsers2 = await Sample.distinct("receiverId", {
    supplierId: userId,
  });
  const allInteracted = [...interactedUsers, ...interactedUsers2, userId];

  // Find users with similar sample categories but not yet interacted
  const userCategories = await Sample.aggregate([
    {
      $match: {
        $or: [{ receiverId: userId }, { supplierId: userId }],
      },
    },
    { $group: { _id: null, categories: { $addToSet: "$category" } } },
  ]);

  const categories = userCategories[0]?.categories || [];

  if (categories.length === 0) {
    return res
      .status(200)
      .json(
        new ApiResponse(200, [], "No connection suggestions available yet")
      );
  }

  // Find potential connections
  const suggestions = await Sample.aggregate([
    {
      $match: {
        category: { $in: categories },
        $or: [
          { supplierId: { $nin: allInteracted } },
          { receiverId: { $nin: allInteracted } },
        ],
      },
    },
    {
      $group: {
        _id: {
          userId: {
            $cond: [
              { $in: ["$supplierId", allInteracted] },
              "$receiverId",
              "$supplierId",
            ],
          },
        },
        commonCategories: { $addToSet: "$category" },
        sampleCount: { $sum: 1 },
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "_id.userId",
        foreignField: "_id",
        as: "user",
      },
    },
    { $unwind: "$user" },
    {
      $project: {
        _id: "$_id.userId",
        name: "$user.name",
        username: "$user.username",
        rating: "$user.rating",
        trustScore: "$user.trustScore",
        isSupplier: "$user.isSupplier",
        commonCategories: 1,
        sampleCount: 1,
        matchScore: {
          $add: [
            { $size: "$commonCategories" },
            { $multiply: ["$user.rating", 0.2] },
            { $multiply: ["$sampleCount", 0.1] },
          ],
        },
      },
    },
    { $sort: { matchScore: -1 } },
    { $limit: parseInt(limit) },
  ]);

  res
    .status(200)
    .json(
      new ApiResponse(
        200,
        suggestions,
        "Connection suggestions fetched successfully"
      )
    );
});

// Get user's order history with enhanced sections for buyer/seller roles
const getUserOrderHistory = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { page = 1, limit = 10, section = "all" } = req.query; // section: 'received', 'toDeliver', 'all'

  const skip = (page - 1) * limit;

  // Get orders received (as buyer)
  const ordersReceived = await Order.find({ buyerId: userId })
    .populate("sellerId", "name username rating")
    .populate("listingId", "itemName imageUrl category type pricePerUnit unit")
    .populate("reviewId")
    .sort({ createdAt: -1 })
    .skip(section === "received" ? skip : 0)
    .limit(section === "received" ? Number(limit) : 20);

  // Get orders to deliver (as seller)
  const ordersToDeliver = await Order.find({ sellerId: userId })
    .populate("buyerId", "name username rating")
    .populate("listingId", "itemName imageUrl category type pricePerUnit unit")
    .sort({ createdAt: -1 })
    .skip(section === "toDeliver" ? skip : 0)
    .limit(section === "toDeliver" ? Number(limit) : 20);

  // Enhanced orders with detailed information
  const enhancedOrdersReceived = ordersReceived.map((order) => {
    const orderObj = order.toObject();
    orderObj.role = "buyer";
    orderObj.counterparty = order.sellerId;
    orderObj.canReview =
      order.isReviewable && !order.reviewId && order.status === "completed";
    orderObj.daysAgo = Math.floor(
      (new Date() - order.createdAt) / (1000 * 60 * 60 * 24)
    );
    orderObj.statusDisplay = getOrderStatusDisplay(order.status, "buyer");
    orderObj.actionRequired = getActionRequired(order, "buyer");
    return orderObj;
  });

  const enhancedOrdersToDeliver = ordersToDeliver.map((order) => {
    const orderObj = order.toObject();
    orderObj.role = "seller";
    orderObj.counterparty = order.buyerId;
    orderObj.daysAgo = Math.floor(
      (new Date() - order.createdAt) / (1000 * 60 * 60 * 24)
    );
    orderObj.statusDisplay = getOrderStatusDisplay(order.status, "seller");
    orderObj.actionRequired = getActionRequired(order, "seller");
    orderObj.canComplete = order.status === "shipped" && order.exchangeCode;
    return orderObj;
  });

  // Get comprehensive statistics
  const [buyerStats, sellerStats] = await Promise.all([
    Order.aggregate([
      { $match: { buyerId: new mongoose.Types.ObjectId(userId) } },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          completedOrders: {
            $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
          },
          pendingOrders: {
            $sum: {
              $cond: [
                { $in: ["$status", ["placed", "confirmed", "shipped"]] },
                1,
                0,
              ],
            },
          },
          totalSpent: { $sum: "$totalAmount" },
          averageOrderValue: { $avg: "$totalAmount" },
        },
      },
    ]),
    Order.aggregate([
      { $match: { sellerId: new mongoose.Types.ObjectId(userId) } },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          completedOrders: {
            $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
          },
          pendingOrders: {
            $sum: {
              $cond: [
                { $in: ["$status", ["placed", "confirmed", "shipped"]] },
                1,
                0,
              ],
            },
          },
          totalEarnings: { $sum: "$totalAmount" },
          averageOrderValue: { $avg: "$totalAmount" },
        },
      },
    ]),
  ]);

  // Count totals for pagination
  const totalReceived = await Order.countDocuments({ buyerId: userId });
  const totalToDeliver = await Order.countDocuments({ sellerId: userId });

  let responseData = {
    statistics: {
      buyer: buyerStats[0] || {
        totalOrders: 0,
        completedOrders: 0,
        pendingOrders: 0,
        totalSpent: 0,
        averageOrderValue: 0,
      },
      seller: sellerStats[0] || {
        totalOrders: 0,
        completedOrders: 0,
        pendingOrders: 0,
        totalEarnings: 0,
        averageOrderValue: 0,
      },
    },
  };

  if (section === "received" || section === "all") {
    responseData.ordersReceived = {
      orders: enhancedOrdersReceived.slice(
        0,
        section === "received" ? Number(limit) : 10
      ),
      pagination:
        section === "received"
          ? {
              current: Number(page),
              pages: Math.ceil(totalReceived / limit),
              total: totalReceived,
              hasNext: page < Math.ceil(totalReceived / limit),
              hasPrev: page > 1,
            }
          : null,
    };
  }

  if (section === "toDeliver" || section === "all") {
    responseData.ordersToDeliver = {
      orders: enhancedOrdersToDeliver.slice(
        0,
        section === "toDeliver" ? Number(limit) : 10
      ),
      pagination:
        section === "toDeliver"
          ? {
              current: Number(page),
              pages: Math.ceil(totalToDeliver / limit),
              total: totalToDeliver,
              hasNext: page < Math.ceil(totalToDeliver / limit),
              hasPrev: page > 1,
            }
          : null,
    };
  }

  res
    .status(200)
    .json(
      new ApiResponse(
        200,
        responseData,
        "User order sections fetched successfully"
      )
    );
});

// Helper function to get status display text
const getOrderStatusDisplay = (status, role) => {
  const statusMap = {
    buyer: {
      placed: "Order Placed",
      confirmed: "Order Confirmed",
      shipped: "Order Shipped",
      completed: "Order Completed",
      cancelled: "Order Cancelled",
    },
    seller: {
      placed: "New Order Received",
      confirmed: "Order Confirmed",
      shipped: "Order Shipped",
      completed: "Order Completed",
      cancelled: "Order Cancelled",
    },
  };
  return statusMap[role][status] || status;
};

// Helper function to determine required actions
const getActionRequired = (order, role) => {
  if (role === "seller") {
    switch (order.status) {
      case "placed":
        return "Confirm Order";
      case "confirmed":
        return "Ship Order";
      case "shipped":
        return "Awaiting Delivery Confirmation";
      case "completed":
        return "Order Complete";
      default:
        return null;
    }
  } else {
    // buyer
    switch (order.status) {
      case "placed":
        return "Awaiting Confirmation";
      case "confirmed":
        return "Order Being Prepared";
      case "shipped":
        return "Confirm Receipt";
      case "completed":
        return order.reviewId ? "Order Complete" : "Add Review";
      default:
        return null;
    }
  }
};

// Get user's review sections (separate for samples and orders)
const getUserReviewSections = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { section = "all" } = req.query; // 'received', 'given', 'all'

  let reviewData = {};

  if (section === "received" || section === "all") {
    // Reviews received by user (grouped by type)
    const [sampleReviews, orderReviews] = await Promise.all([
      Review.find({
        toUserId: userId,
        reviewType: "sample",
        isVerified: true,
      })
        .populate("fromUserId", "name username")
        .populate({
          path: "sampleId",
          select: "itemName category type productDetails",
          populate: {
            path: "productDetails.productId",
            select: "itemName imageUrl",
          },
        })
        .sort({ createdAt: -1 })
        .limit(10),

      Review.find({
        toUserId: userId,
        reviewType: "order",
        isVerified: true,
      })
        .populate("fromUserId", "name username")
        .populate({
          path: "orderId",
          select: "itemName productSnapshot",
          populate: {
            path: "listingId",
            select: "itemName imageUrl",
          },
        })
        .sort({ createdAt: -1 })
        .limit(10),
    ]);

    reviewData.received = {
      samples: sampleReviews.map((review) => ({
        ...review.toObject(),
        daysAgo: Math.floor(
          (new Date() - review.createdAt) / (1000 * 60 * 60 * 24)
        ),
        productInfo: {
          name: review.sampleId?.itemName,
          image: review.sampleId?.productDetails?.productId?.imageUrl,
          category: review.sampleId?.category,
        },
      })),
      orders: orderReviews.map((review) => ({
        ...review.toObject(),
        daysAgo: Math.floor(
          (new Date() - review.createdAt) / (1000 * 60 * 60 * 24)
        ),
        productInfo: {
          name: review.orderId?.itemName,
          image: review.orderId?.listingId?.imageUrl,
          snapshot: review.orderId?.productSnapshot,
        },
      })),
    };
  }

  if (section === "given" || section === "all") {
    // Reviews given by user
    const givenReviews = await Review.find({ fromUserId: userId })
      .populate("toUserId", "name username")
      .populate({
        path: "sampleId",
        select: "itemName category type",
        populate: {
          path: "productDetails.productId",
          select: "itemName imageUrl",
        },
      })
      .populate({
        path: "orderId",
        select: "itemName",
        populate: {
          path: "listingId",
          select: "itemName imageUrl",
        },
      })
      .sort({ createdAt: -1 })
      .limit(20);

    const sampleReviewsGiven = givenReviews.filter(
      (r) => r.reviewType === "sample"
    );
    const orderReviewsGiven = givenReviews.filter(
      (r) => r.reviewType === "order"
    );

    reviewData.given = {
      samples: sampleReviewsGiven.map((review) => ({
        ...review.toObject(),
        daysAgo: Math.floor(
          (new Date() - review.createdAt) / (1000 * 60 * 60 * 24)
        ),
      })),
      orders: orderReviewsGiven.map((review) => ({
        ...review.toObject(),
        daysAgo: Math.floor(
          (new Date() - review.createdAt) / (1000 * 60 * 60 * 24)
        ),
      })),
    };
  }

  // Get reviewable items
  const [reviewableSamples, reviewableOrders] = await Promise.all([
    Sample.find({
      receiverId: userId,
      status: "received",
      isReviewed: false,
    })
      .populate("supplierId", "name username")
      .populate({
        path: "productDetails.productId",
        select: "itemName imageUrl",
      })
      .sort({ createdAt: -1 })
      .limit(10),

    Order.find({
      buyerId: userId,
      status: "completed",
      isReviewable: true,
      reviewId: { $exists: false },
    })
      .populate("sellerId", "name username")
      .populate("listingId", "itemName imageUrl")
      .sort({ createdAt: -1 })
      .limit(10),
  ]);

  reviewData.reviewable = {
    samples: reviewableSamples,
    orders: reviewableOrders,
    total: reviewableSamples.length + reviewableOrders.length,
  };

  res
    .status(200)
    .json(
      new ApiResponse(
        200,
        reviewData,
        "User review sections fetched successfully"
      )
    );
});

// Get user's product listings for their profile
const getUserProductListings = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const {
    page = 1,
    limit = 12,
    status = "all",
    category = "all",
    sortBy = "recent",
  } = req.query;

  const skip = (page - 1) * limit;
  let query = { userId };

  // Filter by status
  if (status === "active") {
    query.isActive = true;
  } else if (status === "inactive") {
    query.isActive = false;
  }

  // Filter by category
  if (category !== "all") {
    query.category = category;
  }

  // Sort options
  let sortOptions = {};
  switch (sortBy) {
    case "recent":
      sortOptions = { createdAt: -1 };
      break;
    case "popular":
      sortOptions = { soldCount: -1 };
      break;
    case "price_low":
      sortOptions = { pricePerUnit: 1 };
      break;
    case "price_high":
      sortOptions = { pricePerUnit: -1 };
      break;
    case "quantity":
      sortOptions = { quantityAvailable: -1 };
      break;
    default:
      sortOptions = { createdAt: -1 };
  }

  const [listings, total, statistics] = await Promise.all([
    SupplierListing.find(query)
      .sort(sortOptions)
      .skip(skip)
      .limit(Number(limit))
      .lean(),

    SupplierListing.countDocuments(query),

    SupplierListing.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId) } },
      {
        $group: {
          _id: null,
          totalListings: { $sum: 1 },
          activeListings: { $sum: { $cond: ["$isActive", 1, 0] } },
          inactiveListings: { $sum: { $cond: ["$isActive", 0, 1] } },
          totalSoldCount: { $sum: "$soldCount" },
          totalRevenue: { $sum: "$totalRevenue" },
          averagePrice: { $avg: "$pricePerUnit" },
          totalQuantityAvailable: { $sum: "$quantityAvailable" },
        },
      },
    ]),
  ]);

  // Enhanced listings with additional info
  const enhancedListings = listings.map((listing) => ({
    ...listing,
    daysListed: Math.floor(
      (new Date() - listing.createdAt) / (1000 * 60 * 60 * 24)
    ),
    performanceStatus: getListingPerformance(listing),
    revenueGenerated: listing.totalRevenue || 0,
    popularityScore: calculatePopularityScore(listing),
  }));

  // Get category breakdown
  const categoryBreakdown = await SupplierListing.aggregate([
    { $match: { userId: new mongoose.Types.ObjectId(userId) } },
    {
      $group: {
        _id: "$category",
        count: { $sum: 1 },
        totalSold: { $sum: "$soldCount" },
        totalRevenue: { $sum: "$totalRevenue" },
        activeCount: { $sum: { $cond: ["$isActive", 1, 0] } },
      },
    },
    { $sort: { count: -1 } },
  ]);

  // Get recent performance metrics
  const recentMetrics = await getRecentListingMetrics(userId);

  res.status(200).json(
    new ApiResponse(
      200,
      {
        listings: enhancedListings,
        statistics: statistics[0] || {
          totalListings: 0,
          activeListings: 0,
          inactiveListings: 0,
          totalSoldCount: 0,
          totalRevenue: 0,
          averagePrice: 0,
          totalQuantityAvailable: 0,
        },
        categoryBreakdown,
        recentMetrics,
        pagination: {
          current: Number(page),
          pages: Math.ceil(total / limit),
          total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1,
        },
      },
      "User product listings fetched successfully"
    )
  );
});

// Helper function to determine listing performance
const getListingPerformance = (listing) => {
  const daysListed = Math.floor(
    (new Date() - listing.createdAt) / (1000 * 60 * 60 * 24)
  );
  const salesRate = daysListed > 0 ? listing.soldCount / daysListed : 0;

  if (salesRate > 0.5) return "excellent";
  if (salesRate > 0.2) return "good";
  if (salesRate > 0.1) return "average";
  return "needs_attention";
};

// Helper function to calculate popularity score
const calculatePopularityScore = (listing) => {
  const daysListed =
    Math.floor((new Date() - listing.createdAt) / (1000 * 60 * 60 * 24)) || 1;
  const salesFrequency = listing.soldCount / daysListed;
  const revenueRate = (listing.totalRevenue || 0) / daysListed;

  return Math.round(salesFrequency * 50 + revenueRate * 0.1);
};

// Helper function to get recent listing metrics
const getRecentListingMetrics = async (userId) => {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const recentOrders = await Order.aggregate([
    {
      $match: {
        sellerId: new mongoose.Types.ObjectId(userId),
        createdAt: { $gte: thirtyDaysAgo },
      },
    },
    {
      $lookup: {
        from: "supplierlistings",
        localField: "listingId",
        foreignField: "_id",
        as: "listing",
      },
    },
    {
      $unwind: "$listing",
    },
    {
      $group: {
        _id: "$listing.category",
        orderCount: { $sum: 1 },
        revenue: { $sum: "$totalAmount" },
      },
    },
    { $sort: { orderCount: -1 } },
  ]);

  return {
    last30Days: recentOrders,
    totalRecentOrders: recentOrders.reduce(
      (sum, cat) => sum + cat.orderCount,
      0
    ),
    totalRecentRevenue: recentOrders.reduce((sum, cat) => sum + cat.revenue, 0),
  };
};

// Get user's material requests for profile
const getUserMaterialRequests = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { page = 1, limit = 10, status = "all" } = req.query;

  const skip = (page - 1) * limit;
  let query = { userId };

  if (status !== "all") {
    query.status = status;
  }

  const [requests, total, statistics] = await Promise.all([
    MaterialRequest.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),

    MaterialRequest.countDocuments(query),

    MaterialRequest.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId) } },
      {
        $group: {
          _id: null,
          totalRequests: { $sum: 1 },
          openRequests: {
            $sum: { $cond: [{ $eq: ["$status", "open"] }, 1, 0] },
          },
          fulfilledRequests: {
            $sum: { $cond: [{ $eq: ["$status", "fulfilled"] }, 1, 0] },
          },
          expiredRequests: {
            $sum: { $cond: [{ $eq: ["$status", "expired"] }, 1, 0] },
          },
          totalWillingPrice: { $sum: "$willingPrice" },
          averageWillingPrice: { $avg: "$willingPrice" },
        },
      },
    ]),
  ]);

  // Enhanced requests with additional info
  const enhancedRequests = requests.map((request) => ({
    ...request,
    daysUntilExpiry: Math.ceil(
      (request.expiresAt - new Date()) / (1000 * 60 * 60 * 24)
    ),
    isExpired: request.expiresAt < new Date(),
    urgencyColor: getUrgencyColor(request.urgency),
    statusColor: getRequestStatusColor(request.status),
    daysActive: Math.floor(
      (new Date() - request.createdAt) / (1000 * 60 * 60 * 24)
    ),
  }));

  res.status(200).json(
    new ApiResponse(
      200,
      {
        requests: enhancedRequests,
        statistics: statistics[0] || {
          totalRequests: 0,
          openRequests: 0,
          fulfilledRequests: 0,
          expiredRequests: 0,
          totalWillingPrice: 0,
          averageWillingPrice: 0,
        },
        pagination: {
          current: Number(page),
          pages: Math.ceil(total / limit),
          total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1,
        },
      },
      "User material requests fetched successfully"
    )
  );
});

// Get user's notification summary for profile
const getUserNotificationSummary = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  const [summary, recentNotifications, categoryStats] = await Promise.all([
    Notification.getUserNotificationSummary(userId),

    Notification.find({ userId, isRead: false })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean(),

    Notification.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId) } },
      {
        $group: {
          _id: "$category",
          total: { $sum: 1 },
          unread: { $sum: { $cond: ["$isRead", 0, 1] } },
          actionRequired: { $sum: { $cond: ["$actionRequired", 1, 0] } },
        },
      },
      { $sort: { total: -1 } },
    ]),
  ]);

  const enhancedRecentNotifications = recentNotifications.map(
    (notification) => ({
      ...notification,
      timeAgo: getTimeAgo(notification.createdAt),
      priorityColor: getPriorityColor(notification.priority),
      typeIcon: getTypeIcon(notification.type),
    })
  );

  res.status(200).json(
    new ApiResponse(
      200,
      {
        summary,
        recentNotifications: enhancedRecentNotifications,
        categoryStats,
      },
      "User notification summary fetched successfully"
    )
  );
});

// Helper functions for material requests and notifications
const getUrgencyColor = (urgency) => {
  switch (urgency) {
    case "high":
      return "#ff4757";
    case "medium":
      return "#ffa502";
    case "low":
      return "#2ed573";
    default:
      return "#747d8c";
  }
};

const getRequestStatusColor = (status) => {
  switch (status) {
    case "open":
      return "#2ed573";
    case "fulfilled":
      return "#5a95e1";
    case "expired":
      return "#ff6b81";
    case "canceled":
      return "#747d8c";
    default:
      return "#747d8c";
  }
};

const getTimeAgo = (date) => {
  const seconds = Math.floor((new Date() - date) / 1000);

  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 2592000) return `${Math.floor(seconds / 86400)}d ago`;

  return date.toLocaleDateString();
};

const getPriorityColor = (priority) => {
  switch (priority) {
    case "urgent":
      return "#ff3838";
    case "high":
      return "#ff6b35";
    case "medium":
      return "#f7b731";
    case "low":
      return "#5a95e1";
    default:
      return "#747d8c";
  }
};

const getTypeIcon = (type) => {
  const iconMap = {
    material_request_response: "📝",
    material_request_accepted: "✅",
    material_request_rejected: "❌",
    order_placed: "🛒",
    order_confirmed: "✅",
    order_shipped: "🚚",
    order_completed: "🎉",
    sample_request: "🧪",
    review_received: "⭐",
    connection_request: "👥",
    system_announcement: "📢",
  };
  return iconMap[type] || "📬";
};

// Get user's negotiations for profile
const getUserNegotiations = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { page = 1, limit = 10, status = "all", role = "all" } = req.query;

  const skip = (page - 1) * limit;
  let query = {};

  // Role-based filtering
  if (role === "buyer") {
    query.buyerId = userId;
  } else if (role === "seller") {
    query.sellerId = userId;
  } else {
    query.$or = [{ buyerId: userId }, { sellerId: userId }];
  }

  // Status filtering
  if (status !== "all") {
    query.negotiationStatus = status;
  }

  const [negotiations, total, statistics] = await Promise.all([
    Negotiation.find(query)
      .populate("buyerId", "name username")
      .populate("sellerId", "name username")
      .populate({
        path: "orderId",
        select: "itemName listingId",
        populate: {
          path: "listingId",
          select: "itemName imageUrl",
        },
      })
      .populate({
        path: "materialRequestId",
        select: "itemName imageUrl category",
      })
      .sort({ lastActivity: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),

    Negotiation.countDocuments(query),

    Negotiation.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalNegotiations: { $sum: 1 },
          activeNegotiations: {
            $sum: { $cond: [{ $eq: ["$negotiationStatus", "active"] }, 1, 0] },
          },
          agreedNegotiations: {
            $sum: { $cond: [{ $eq: ["$negotiationStatus", "agreed"] }, 1, 0] },
          },
          canceledNegotiations: {
            $sum: {
              $cond: [{ $eq: ["$negotiationStatus", "canceled"] }, 1, 0],
            },
          },
          asBuyer: {
            $sum: {
              $cond: [
                { $eq: ["$buyerId", new mongoose.Types.ObjectId(userId)] },
                1,
                0,
              ],
            },
          },
          asSeller: {
            $sum: {
              $cond: [
                { $eq: ["$sellerId", new mongoose.Types.ObjectId(userId)] },
                1,
                0,
              ],
            },
          },
        },
      },
    ]),
  ]);

  // Enhanced negotiations with additional info
  const enhancedNegotiations = negotiations.map((negotiation) => ({
    ...negotiation,
    userRole:
      negotiation.buyerId._id.toString() === userId ? "buyer" : "seller",
    counterparty:
      negotiation.buyerId._id.toString() === userId
        ? negotiation.sellerId
        : negotiation.buyerId,
    unreadCount: negotiation.messages.filter(
      (msg) => !msg.isRead && msg.senderId.toString() !== userId
    ).length,
    lastMessage: negotiation.messages[negotiation.messages.length - 1],
    timeAgo: getTimeAgo(negotiation.lastActivity),
    statusColor: getNegotiationStatusColor(negotiation.negotiationStatus),
    isExpired: negotiation.expiresAt < new Date(),
    itemName:
      negotiation.orderId?.itemName || negotiation.materialRequestId?.itemName,
    itemImage:
      negotiation.orderId?.listingId?.imageUrl ||
      negotiation.materialRequestId?.imageUrl,
    daysActive: Math.floor(
      (new Date() - negotiation.createdAt) / (1000 * 60 * 60 * 24)
    ),
    canPlaceOrder:
      negotiation.negotiationStatus === "agreed" &&
      negotiation.buyerId._id.toString() === userId,
  }));

  const successRate = statistics[0]
    ? (
        (statistics[0].agreedNegotiations / statistics[0].totalNegotiations) *
        100
      ).toFixed(1)
    : 0;

  res.status(200).json(
    new ApiResponse(
      200,
      {
        negotiations: enhancedNegotiations,
        statistics: {
          ...(statistics[0] || {
            totalNegotiations: 0,
            activeNegotiations: 0,
            agreedNegotiations: 0,
            canceledNegotiations: 0,
            asBuyer: 0,
            asSeller: 0,
          }),
          successRate: parseFloat(successRate),
        },
        pagination: {
          current: Number(page),
          pages: Math.ceil(total / limit),
          total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1,
        },
      },
      "User negotiations fetched successfully"
    )
  );
});

// Helper function for negotiation status colors
const getNegotiationStatusColor = (status) => {
  switch (status) {
    case "active":
      return "#3b82f6";
    case "agreed":
      return "#10b981";
    case "canceled":
      return "#ef4444";
    case "expired":
      return "#6b7280";
    default:
      return "#6b7280";
  }
};

// Get user statistics (alias for getUserCompleteProfile for backward compatibility)
const getUserStatistics = getUserCompleteProfile;

// Update user profile
const updateUserProfile = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const updateData = req.body;

  // Remove sensitive fields that shouldn't be updated via this endpoint
  delete updateData.password;
  delete updateData.refresh_token;
  delete updateData.isEmailVerified;
  delete updateData.rating;
  delete updateData.trustScore;

  const updatedUser = await User.findByIdAndUpdate(userId, updateData, {
    new: true,
    runValidators: true,
  }).select("-password -refresh_token");

  if (!updatedUser) {
    throw new ApiError(404, "User not found");
  }

  res
    .status(200)
    .json(new ApiResponse(200, updatedUser, "Profile updated successfully"));
});

// Get user connections
const getConnections = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  // This is a placeholder - you might want to implement a proper connections system
  // For now, returning users who have interacted with samples
  const connections = await Sample.aggregate([
    {
      $match: {
        $or: [{ receiverId: userId }, { supplierId: userId }],
      },
    },
    {
      $group: {
        _id: {
          $cond: [
            { $eq: ["$receiverId", userId] },
            "$supplierId",
            "$receiverId",
          ],
        },
        interactionCount: { $sum: 1 },
        lastInteraction: { $max: "$createdAt" },
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "_id",
        foreignField: "_id",
        as: "user",
      },
    },
    { $unwind: "$user" },
    {
      $project: {
        _id: "$_id",
        name: "$user.name",
        username: "$user.username",
        rating: "$user.rating",
        interactionCount: 1,
        lastInteraction: 1,
      },
    },
    { $sort: { lastInteraction: -1 } },
    { $limit: 50 },
  ]);

  res
    .status(200)
    .json(
      new ApiResponse(200, connections, "Connections fetched successfully")
    );
});

// Send connection request
const sendConnectionRequest = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const requesterId = req.user._id;

  if (userId === requesterId.toString()) {
    throw new ApiError(400, "Cannot send connection request to yourself");
  }

  const targetUser = await User.findById(userId);
  if (!targetUser) {
    throw new ApiError(404, "User not found");
  }

  // Create notification for connection request
  await Notification.create({
    userId: userId,
    type: "connection_request",
    category: "social",
    title: "New Connection Request",
    message: `${req.user.name} sent you a connection request`,
    actionRequired: true,
    metadata: {
      requesterId: requesterId,
      requesterName: req.user.name,
    },
  });

  res
    .status(200)
    .json(new ApiResponse(200, null, "Connection request sent successfully"));
});

// Respond to connection request
const respondToConnectionRequest = asyncHandler(async (req, res) => {
  const { requestId } = req.params;
  const { response } = req.body; // 'accept' or 'reject'

  const notification = await Notification.findById(requestId);
  if (!notification || notification.type !== "connection_request") {
    throw new ApiError(404, "Connection request not found");
  }

  if (notification.userId.toString() !== req.user._id.toString()) {
    throw new ApiError(403, "Unauthorized to respond to this request");
  }

  // Update the notification
  notification.isRead = true;
  notification.actionRequired = false;
  notification.metadata.response = response;
  notification.metadata.respondedAt = new Date();
  await notification.save();

  // Send response notification to requester
  await Notification.create({
    userId: notification.metadata.requesterId,
    type: "connection_response",
    category: "social",
    title: `Connection Request ${response === "accept" ? "Accepted" : "Rejected"}`,
    message: `${req.user.name} ${response === "accept" ? "accepted" : "rejected"} your connection request`,
    metadata: {
      responderId: req.user._id,
      responderName: req.user.name,
      response: response,
    },
  });

  res
    .status(200)
    .json(
      new ApiResponse(
        200,
        null,
        `Connection request ${response}ed successfully`
      )
    );
});

// Upload profile picture
const uploadProfilePicture = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new ApiError(400, "Profile picture file is required");
  }

  // Here you would typically upload to Cloudinary
  // For now, just returning a placeholder response
  const imageUrl = `/uploads/profiles/${req.file.filename}`;

  const updatedUser = await User.findByIdAndUpdate(
    req.user._id,
    { profilePicture: imageUrl },
    { new: true }
  ).select("-password -refresh_token");

  res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { imageUrl, user: updatedUser },
        "Profile picture uploaded successfully"
      )
    );
});

// Upload cover image
const uploadCoverImage = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new ApiError(400, "Cover image file is required");
  }

  // Here you would typically upload to Cloudinary
  const imageUrl = `/uploads/covers/${req.file.filename}`;

  const updatedUser = await User.findByIdAndUpdate(
    req.user._id,
    { coverImage: imageUrl },
    { new: true }
  ).select("-password -refresh_token");

  res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { imageUrl, user: updatedUser },
        "Cover image uploaded successfully"
      )
    );
});

module.exports = {
  getUserStatistics,
  getUserCompleteProfile,
  updateUserProfile,
  getConnections,
  sendConnectionRequest,
  respondToConnectionRequest,
  uploadProfilePicture,
  uploadCoverImage,
  getConnectionSuggestions,
  getUserOrderHistory,
  getUserReviewSections,
  getUserProductListings,
  getUserMaterialRequests,
  getUserNotificationSummary,
  getUserNegotiations,
};
