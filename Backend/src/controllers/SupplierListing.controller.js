const SupplierListing = require('../models/SupplierListing.model');
const User = require('../models/User.model');
const uploadOnCloudinary = require('../utils/cloudinary');

// Create a new product listing
const createProduct = async (req, res) => {
    try {
        const {
            itemName,
            quantityAvailable,
            unit,
            pricePerUnit,
            deliveryAvailable,
            deliveryFee,
            location,
            type,
            category,
            description
        } = req.body;

        // Check if user exists and is a supplier
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ 
                success: false,
                message: 'User not found' 
            });
        }

        if (!user.isSupplier) {
            return res.status(403).json({ 
                success: false,
                message: 'Only suppliers can create product listings' 
            });
        }

        // Check if image files are provided (minimum 4 required)
        if (!req.files || !req.files.images) {
            return res.status(400).json({
                success: false,
                message: 'Product images are required (minimum 4 images)'
            });
        }

        let imageFiles = req.files.images;
        
        // Ensure images is an array
        if (!Array.isArray(imageFiles)) {
            imageFiles = [imageFiles];
        }

        // Check minimum image requirement
        if (imageFiles.length < 4) {
            return res.status(400).json({
                success: false,
                message: 'Minimum 4 images are required for product listing'
            });
        }

        // Check maximum image limit (optional - set to 10)
        if (imageFiles.length > 10) {
            return res.status(400).json({
                success: false,
                message: 'Maximum 10 images are allowed for product listing'
            });
        }

        // Upload all images to Cloudinary
        const imageUploadPromises = imageFiles.map(imageFile => 
            uploadOnCloudinary(imageFile.tempFilePath)
        );

        const cloudinaryResponses = await Promise.all(imageUploadPromises);
        
        // Check if all uploads were successful
        const failedUploads = cloudinaryResponses.filter(response => !response);
        if (failedUploads.length > 0) {
            return res.status(500).json({
                success: false,
                message: `Failed to upload ${failedUploads.length} image(s) to Cloudinary`
            });
        }

        // Extract image URLs and metadata
        const imageUrls = cloudinaryResponses.map(response => response.secure_url);
        const imageDetails = cloudinaryResponses.map((response, index) => ({
            url: response.secure_url,
            publicId: response.public_id,
            format: response.format,
            size: response.bytes,
            isPrimary: index === 0 // First image is primary
        }));

        const newProduct = new SupplierListing({
            userId: req.user.id,
            itemName,
            imageUrl: imageUrls[0], // Primary image URL (first image)
            imageUrls: imageUrls, // All image URLs
            imageDetails: imageDetails, // Detailed image information
            quantityAvailable,
            unit,
            pricePerUnit,
            deliveryAvailable: deliveryAvailable || false,
            deliveryFee: deliveryFee || 0,
            location,
            type,
            category,
            description
        });

        const savedProduct = await newProduct.save();
        await savedProduct.populate('userId', 'name username fullname phone email');

        res.status(201).json({
            success: true,
            message: 'Product created successfully',
            data: savedProduct
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            message: 'Error creating product',
            error: error.message
        });
    }
};

// Get all products with filtering and pagination
const getAllProducts = async (req, res) => {
    try {
        const {
            type,
            category,
            page = 1,
            limit = 10,
            sortBy = 'createdAt',
            sortOrder = 'desc',
            minPrice,
            maxPrice,
            location,
            radius = 10 // in km
        } = req.query;

        // Build filter object
        const filter = { isActive: true };

        if (type) {
            filter.type = type;
        }

        if (category) {
            filter.category = category;
        }

        if (minPrice || maxPrice) {
            filter.pricePerUnit = {};
            if (minPrice) filter.pricePerUnit.$gte = Number(minPrice);
            if (maxPrice) filter.pricePerUnit.$lte = Number(maxPrice);
        }

        // Geospatial query if location is provided
        if (location) {
            const [lat, lng] = location.split(',').map(Number);
            const radiusInRadians = radius / 6371; // Convert km to radians

            filter['location.lat'] = {
                $gte: lat - radiusInRadians,
                $lte: lat + radiusInRadians
            };
            filter['location.lng'] = {
                $gte: lng - radiusInRadians,
                $lte: lng + radiusInRadians
            };
        }

        const skip = (page - 1) * limit;
        const sortOptions = {};
        sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

        const products = await SupplierListing.find(filter)
            .populate('userId', 'name username fullname phone email rating trustScore')
            .sort(sortOptions)
            .skip(skip)
            .limit(Number(limit));

        const total = await SupplierListing.countDocuments(filter);

        res.status(200).json({
            success: true,
            data: products,
            pagination: {
                current: Number(page),
                pages: Math.ceil(total / limit),
                total,
                hasNext: page < Math.ceil(total / limit),
                hasPrev: page > 1
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error fetching products',
            error: error.message
        });
    }
};

// Get products by type (raw, half-baked, complete)
const getProductsByType = async (req, res) => {
    try {
        const { type } = req.params;
        const { page = 1, limit = 10, category } = req.query;

        if (!['raw', 'half-baked', 'complete'].includes(type)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid type. Must be raw, half-baked, or complete'
            });
        }

        const filter = { type, isActive: true };
        if (category) filter.category = category;

        const skip = (page - 1) * limit;

        const products = await SupplierListing.find(filter)
            .populate('userId', 'name username fullname phone email rating trustScore')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(Number(limit));

        const total = await SupplierListing.countDocuments(filter);

        res.status(200).json({
            success: true,
            data: products,
            type,
            pagination: {
                current: Number(page),
                pages: Math.ceil(total / limit),
                total
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error fetching products by type',
            error: error.message
        });
    }
};

// Get products by supplier
const getProductsBySupplier = async (req, res) => {
    try {
        const { supplierId } = req.params;
        const { page = 1, limit = 10, type, category } = req.query;
        
        const filter = { userId: supplierId, isActive: true };
        if (type) filter.type = type;
        if (category) filter.category = category;

        const skip = (page - 1) * limit;

        const products = await SupplierListing.find(filter)
            .populate('userId', 'name username fullname phone email rating trustScore ordersFulfilled')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(Number(limit));

        const total = await SupplierListing.countDocuments(filter);

        res.status(200).json({
            success: true,
            message: 'Supplier products retrieved successfully',
            data: products,
            pagination: {
                current: Number(page),
                pages: Math.ceil(total / limit),
                total
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error retrieving supplier products',
            error: error.message
        });
    }
};

// Get single product by ID
const getProductById = async (req, res) => {
    try {
        const { id } = req.params;

        const product = await SupplierListing.findById(id)
            .populate('userId', 'name username fullname phone email rating trustScore ordersFulfilled');

        if (!product) {
            return res.status(404).json({
                success: false,
                message: 'Product not found'
            });
        }

        res.status(200).json({
            success: true,
            data: product
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error fetching product',
            error: error.message
        });
    }
};

// Update product (only by owner)
const updateProduct = async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body;

        const product = await SupplierListing.findById(id);

        if (!product) {
            return res.status(404).json({
                success: false,
                message: 'Product not found'
            });
        }

        // Check if user is the owner of the product
        if (product.userId.toString() !== req.user.id) {
            return res.status(403).json({
                success: false,
                message: 'You can only update your own products'
            });
        }

        // Handle image update if new images are provided
        if (req.files && req.files.images) {
            let imageFiles = req.files.images;
            
            // Ensure images is an array
            if (!Array.isArray(imageFiles)) {
                imageFiles = [imageFiles];
            }

            // Check minimum image requirement
            if (imageFiles.length < 4) {
                return res.status(400).json({
                    success: false,
                    message: 'Minimum 4 images are required for product listing'
                });
            }

            // Check maximum image limit
            if (imageFiles.length > 10) {
                return res.status(400).json({
                    success: false,
                    message: 'Maximum 10 images are allowed for product listing'
                });
            }

            // Upload all new images to Cloudinary
            const imageUploadPromises = imageFiles.map(imageFile => 
                uploadOnCloudinary(imageFile.tempFilePath)
            );

            const cloudinaryResponses = await Promise.all(imageUploadPromises);
            
            // Check if all uploads were successful
            const failedUploads = cloudinaryResponses.filter(response => !response);
            if (failedUploads.length > 0) {
                return res.status(500).json({
                    success: false,
                    message: `Failed to upload ${failedUploads.length} image(s) to Cloudinary`
                });
            }

            // Extract image URLs and metadata
            const imageUrls = cloudinaryResponses.map(response => response.secure_url);
            const imageDetails = cloudinaryResponses.map((response, index) => ({
                url: response.secure_url,
                publicId: response.public_id,
                format: response.format,
                size: response.bytes,
                isPrimary: index === 0 // First image is primary
            }));
            
            // Update image-related fields
            updateData.imageUrl = imageUrls[0]; // Primary image
            updateData.imageUrls = imageUrls; // All images
            updateData.imageDetails = imageDetails; // Detailed info
        }

        const updatedProduct = await SupplierListing.findByIdAndUpdate(
            id,
            updateData,
            { new: true, runValidators: true }
        ).populate('userId', 'name username fullname phone email');

        res.status(200).json({
            success: true,
            message: 'Product updated successfully',
            data: updatedProduct
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            message: 'Error updating product',
            error: error.message
        });
    }
};

// Delete product (only by owner)
const deleteProduct = async (req, res) => {
    try {
        const { id } = req.params;

        const product = await SupplierListing.findById(id);

        if (!product) {
            return res.status(404).json({
                success: false,
                message: 'Product not found'
            });
        }

        // Check if user is the owner of the product
        if (product.userId.toString() !== req.user.id) {
            return res.status(403).json({
                success: false,
                message: 'You can only delete your own products'
            });
        }

        await SupplierListing.findByIdAndDelete(id);

        res.status(200).json({
            success: true,
            message: 'Product deleted successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error deleting product',
            error: error.message
        });
    }
};

// Get user's own products
const getMyProducts = async (req, res) => {
    try {
        const { page = 1, limit = 10, type, category } = req.query;

        const filter = { userId: req.user.id };
        if (type) filter.type = type;
        if (category) filter.category = category;

        const skip = (page - 1) * limit;

        const products = await SupplierListing.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(Number(limit));

        const total = await SupplierListing.countDocuments(filter);

        res.status(200).json({
            success: true,
            data: products,
            pagination: {
                current: Number(page),
                pages: Math.ceil(total / limit),
                total
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error fetching your products',
            error: error.message
        });
    }
};

// Toggle product active status
const toggleProductStatus = async (req, res) => {
    try {
        const { id } = req.params;

        const product = await SupplierListing.findById(id);

        if (!product) {
            return res.status(404).json({
                success: false,
                message: 'Product not found'
            });
        }

        // Check if user is the owner of the product
        if (product.userId.toString() !== req.user.id) {
            return res.status(403).json({
                success: false,
                message: 'You can only modify your own products'
            });
        }

        product.isActive = !product.isActive;
        await product.save();

        res.status(200).json({
            success: true,
            message: `Product ${product.isActive ? 'activated' : 'deactivated'} successfully`,
            data: product
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error updating product status',
            error: error.message
        });
    }
};

// Upload multiple images to Cloudinary (separate endpoint)
const uploadImages = async (req, res) => {
    try {
        // Check if image files are provided
        if (!req.files || !req.files.images) {
            return res.status(400).json({
                success: false,
                message: 'Image files are required (minimum 4 images)'
            });
        }

        let imageFiles = req.files.images;
        
        // Ensure images is an array
        if (!Array.isArray(imageFiles)) {
            imageFiles = [imageFiles];
        }

        // Check minimum image requirement
        if (imageFiles.length < 4) {
            return res.status(400).json({
                success: false,
                message: 'Minimum 4 images are required'
            });
        }

        // Check maximum image limit
        if (imageFiles.length > 10) {
            return res.status(400).json({
                success: false,
                message: 'Maximum 10 images are allowed'
            });
        }

        // Upload all images to Cloudinary
        const imageUploadPromises = imageFiles.map(imageFile => 
            uploadOnCloudinary(imageFile.tempFilePath)
        );

        const cloudinaryResponses = await Promise.all(imageUploadPromises);
        
        // Check if all uploads were successful
        const failedUploads = cloudinaryResponses.filter(response => !response);
        if (failedUploads.length > 0) {
            return res.status(500).json({
                success: false,
                message: `Failed to upload ${failedUploads.length} image(s) to Cloudinary`
            });
        }

        // Prepare response data
        const uploadedImages = cloudinaryResponses.map((response, index) => ({
            url: response.secure_url,
            publicId: response.public_id,
            format: response.format,
            size: response.bytes,
            isPrimary: index === 0,
            uploadedAt: new Date()
        }));

        res.status(200).json({
            success: true,
            message: `${cloudinaryResponses.length} images uploaded successfully`,
            data: {
                images: uploadedImages,
                primaryImage: uploadedImages[0],
                totalImages: uploadedImages.length
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error uploading images',
            error: error.message
        });
    }
};

module.exports = {
    createProduct,
    getAllProducts,
    getProductsByType,
    getProductsBySupplier,
    getProductById,
    updateProduct,
    deleteProduct,
    getMyProducts,
    toggleProductStatus,
    uploadImages
};