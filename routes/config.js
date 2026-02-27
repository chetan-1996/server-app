const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const PricingConfig = require('../models/PricingConfig');

// Database connection check utility
const checkDatabaseConnection = () => {
  return global.isDatabaseConnected && mongoose.connection.readyState === 1;
};

// Database operation wrapper with timeout and error handling
const dbOperation = async (operation, timeoutMs = 5000) => {
  if (!checkDatabaseConnection()) {
    throw new Error('Database not connected');
  }
  
  return Promise.race([
    operation(),
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Database operation timeout')), timeoutMs)
    )
  ]);
};

const wireConfigKeys = [
  'dcWireBlack',
  'dcWireRed',
  'acWireRed',
  'acWireBlack',
  'acWireBlue',
  'acWireYellow',
  'earthingWireGreen',
  'laEarthingWireGreen'
];

const sanitizeWireConfigurations = (wireConfigurations = {}) => {
  return wireConfigKeys.reduce((acc, key) => {
    const entries = Array.isArray(wireConfigurations[key]) ? wireConfigurations[key] : [];

    acc[key] = entries
      .map((item = {}, index) => {
        const size = (item.size || item.name || '').toString().trim();
        const defaultLength = (item.defaultLength ?? item.length ?? '').toString().trim();

        if (!size) return null;

        const priceValue = Number(item.price ?? item.pricePerUnit ?? 0);
        const price = Number.isFinite(priceValue) ? priceValue : 0;
        const id = item.id || item._id || `${key}-${size}-${defaultLength || index}`;

        return {
          id,
          size,
          defaultLength,
          price,
          isDefault: Boolean(item.isDefault)
        };
      })
      .filter(Boolean);

    return acc;
  }, wireConfigKeys.reduce((acc, key) => ({ ...acc, [key]: [] }), {}));
};

// Default configuration
const defaultConfig = {
  kitPricing: {
    solarPanel: [],
    maxModuleCount: 0,
    inverter: [],
    structure: [],
    showStructureSection: true,
    nutBoltingStructures: [],
    showNutBoltingSection: true,
    acdb: [],
    dcdb: [],
    earthingKit: [],
    clamps: [],
    ssTie: [],
    wire: [],
    jBolt: [],
    uBolt: [],
    transport: {
      description: '',
      cost: 0
    },
    solarInsurance: {
      description: '',
      cost: 0
    },
    insuranceRanges: [],
    wireConfigurations: wireConfigKeys.reduce((acc, key) => ({ ...acc, [key]: [] }), {}),
    marginPercentage: 0,
    gstPercentage: 0,
    mountingAccessories: [],
    structureAccessories: [],
    pvcPipeConfigurations: []
  },
  directSalesPricing: {
    panels: [],
    inverters: [],
    structures: [],
    showStructureSection: true,
    nutBoltingStructures: [],
    showNutBoltingSection: true,
    moduleBosPrices: [],
    regularUserProfitMargins: [],
    insuranceRanges: [],
    costs: {
      bosPrice: 0,
      adminCost: 0,
      pipePrice: 0,
      transportCost: 0,
      commissionExpense: 0,
      installationServiceCharges: 0,
      profitMargin: 0,
      maxDiscountPerKW: 0,
      solarEfficiency: 0,
      electricityRate: 0,
      directSalesGST: 0,
      channelPartnerProfitMargin: 0,
      channelPartnerMinProfit: 0,
      channelPartnerMaxDiscount: 0,
      channelPartnerServiceCharge: 0,
      channelPartnerMarketingFee: 0,
      channelPartnerAdminCost: 0,
      brandAssociateDefaultProfit: 0,
      brandAssociateMinProfit: 0,
      brandAssociateMaxDiscount: 0,
      brandAssociateSupportFee: 0,
      brandAssociateBrandingFee: 0,
      brandAssociateTrainingCost: 0
    },
    customCosts: [],
    wireConfigurations: wireConfigKeys.reduce((acc, key) => ({ ...acc, [key]: [] }), {}),
    pvcAccessories: []
  }
};

// Get latest pricing configuration
router.get('/', async (req, res) => {
  const { location = 'surat' } = req.query; // Default to surat
  
  if (!location) {
    return res.status(400).json({ 
      message: 'Location parameter is required',
      kitPricing: {},
      directSalesPricing: {},
      location: 'unknown',
      error: 'Location parameter is required',
      timestamp: new Date().toISOString()
    });
  }
  
  try {
    // Check database connection first
    if (!checkDatabaseConnection()) {
      console.error('Database not connected when fetching config');
      return res.status(503).json({ 
        message: 'Database not connected',
        kitPricing: defaultConfig.kitPricing || {},
        directSalesPricing: defaultConfig.directSalesPricing || {},
        location,
        error: 'Database connection error',
        timestamp: new Date().toISOString()
      });
    }
    
    // Try to find config for the specified location
    const config = await PricingConfig.findOne({ location });
    
    if (config) {
      return res.json({
        kitPricing: config.kitPricing || {},
        directSalesPricing: config.directSalesPricing || {},
        location: config.location || location
      });
    }
    
    // If no config exists, create a default one for this location
    const newConfig = new PricingConfig({
      ...defaultConfig,
      location,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    
    const savedConfig = await newConfig.save();
    
    res.json({
      kitPricing: savedConfig.kitPricing || {},
      directSalesPricing: savedConfig.directSalesPricing || {},
      location: savedConfig.location || location
    });
    
  } catch (error) {
    console.error(`Error fetching config for location ${location}:`, error);
    res.status(500).json({
      message: 'Error fetching configuration',
      kitPricing: defaultConfig.kitPricing || {},
      directSalesPricing: defaultConfig.directSalesPricing || {},
      location,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Save or update pricing configuration
router.post('/', async (req, res) => {
  try {
    // Validate the required structure
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ message: 'Invalid request body format' });
    }
    
    const { 
      location = 'surat', 
      kitPricing = {}, 
      directSalesPricing = {},
      wireConfigurations: legacyWireConfigurations = {}
    } = req.body;

    const sanitizedKitPricing = {
      ...kitPricing,
      wireConfigurations: sanitizeWireConfigurations(kitPricing.wireConfigurations)
    };

    const sanitizedDirectSalesPricing = {
      ...directSalesPricing,
      wireConfigurations: sanitizeWireConfigurations(directSalesPricing.wireConfigurations)
    };

    const sanitizedLegacyWireConfigurations = sanitizeWireConfigurations(legacyWireConfigurations);
    
    if (!location) {
      return res.status(400).json({ message: 'Location is required' });
    }
    
    // Find existing config for this location
    let config = await PricingConfig.findOne({ location });
    
    if (config) {
      // Merge existing config with new values
      config.kitPricing = {
        ...defaultConfig.kitPricing,
        ...(config.kitPricing || {}),
        ...sanitizedKitPricing
      };
      
      config.directSalesPricing = {
        ...defaultConfig.directSalesPricing,
        ...(config.directSalesPricing || {}),
        ...sanitizedDirectSalesPricing
      };
      
      config.updatedAt = new Date();
      config.updatedAt = new Date();
    } else {
      // Create new config for this location with defaults merged with provided values
      config = new PricingConfig({
        location,
        kitPricing: {
          ...defaultConfig.kitPricing,
          ...sanitizedKitPricing
        },
        directSalesPricing: {
          ...defaultConfig.directSalesPricing,
          ...sanitizedDirectSalesPricing
        },
        wireConfigurations: sanitizedLegacyWireConfigurations,
        createdAt: new Date(),
        updatedAt: new Date()
      });
    }
    
    // Save the config
    // Final safety: sanitize all wire collections before save
    config.wireConfigurations = sanitizeWireConfigurations(config.wireConfigurations);
    if (config.kitPricing?.wireConfigurations) {
      config.kitPricing.wireConfigurations = sanitizeWireConfigurations(config.kitPricing.wireConfigurations);
    }
    if (config.directSalesPricing?.wireConfigurations) {
      config.directSalesPricing.wireConfigurations = sanitizeWireConfigurations(config.directSalesPricing.wireConfigurations);
    }
    if (config.kitSettings?.wireConfigurations) {
      config.kitSettings.wireConfigurations = sanitizeWireConfigurations(config.kitSettings.wireConfigurations);
    }

    const savedConfig = await config.save();
    
    // Emit real-time update to all connected clients
    const io = req.app.get('io');
    if (io) {
      // Emit to all clients
      io.emit('pricing-config-updated', savedConfig);
      
      // Also emit to specific room for this location
      io.to(`location-${location}`).emit('location-config-updated', {
        location,
        kitPricing: savedConfig.kitPricing,
        directSalesPricing: savedConfig.directSalesPricing
      });
    }

    res.json(savedConfig);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Initialize with default configuration (for resetting corrupted data)
router.post('/reset', async (req, res) => {
  try {
    const { location } = req.body;
    
    if (location) {
      // Reset specific location
      await PricingConfig.deleteOne({ location });
      
      const newConfig = new PricingConfig({
        ...defaultConfig,
        location,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      
      const savedConfig = await newConfig.save();
      
      return res.status(200).json({ 
        message: `Configuration for ${location} reset successfully`,
        config: savedConfig 
      });
    }
    
    // Reset all configurations
    await PricingConfig.deleteMany({});
    
    // Create default config for 'surat'
    const newConfig = new PricingConfig({
      ...defaultConfig,
      location: 'surat',
      createdAt: new Date(),
      updatedAt: new Date()
    });
    
    const savedConfig = await newConfig.save();
    
    res.status(200).json({ 
      message: 'All configurations reset successfully',
      config: savedConfig 
    });
    
  } catch (error) {
    console.error('Error resetting configuration:', error);
    res.status(500).json({ 
      message: 'Error resetting configuration',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
