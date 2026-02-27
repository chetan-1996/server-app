const mongoose = require('mongoose');

// Schema for wattage options
const WattageOptionSchema = new mongoose.Schema({
  watt: { type: Number, required: true },
  price: { type: Number, required: true }
}, { _id: false });


// Schema for panels in direct sales
const PanelSchema = new mongoose.Schema({
  id: { type: Number, required: true },
  name: { type: String, required: true },
  wattageOptions: { type: [Number], default: [] },
  pricePerWatt: { type: Number, default: 0 }
}, { _id: false });


// Schema for panels in kit settings
const KitPanelSchema = new mongoose.Schema({
  id: { type: Number, required: true },
  name: { type: String, required: true },
  wattageOptions: { type: [mongoose.Schema.Types.Mixed], default: [] },
  pricePerWatt: { type: Number, default: 0 },
  directSalesPanelId: { type: Number }
}, { _id: false });

// Schema for KW ratings
const KwRatingSchema = new mongoose.Schema({
  kw: { type: Number, required: true },
  price: { type: Number, required: true }
}, { _id: false });

// Schema for inverters
const InverterSchema = new mongoose.Schema({
  id: { type: Number, required: true },
  name: { type: String, required: true },
  kwRatings: { type: [KwRatingSchema], default: [] },
  directSalesInverterId: { type: Number }
}, { _id: false });

// Schema for structures
const StructureSchema = new mongoose.Schema({
  id: { type: Number, required: true },
  name: { type: String, required: true },
  pricePerUnit: { type: Number, default: 0 },
  pipePrice: { type: Number, default: 0 },
  directSalesStructureId: { type: Number }
}, { _id: false });

// Schema for nut bolting structures in direct sales
const NutBoltingStructureSchema = new mongoose.Schema({
  id: { type: Number, required: true },
  name: { type: String, required: true },
  frontHeight: { type: Number, required: true },
  panelCount: { type: Number, required: true },
  price: { type: Number, required: true },
  withWalkwayPrice: { type: Number, default: 0 },
  withoutWalkwayPrice: { type: Number, default: 0 },
  // Reference back to Direct Sales mapping
  directSalesFrontHeightRef: { type: Number },
  directSalesStructureIdRef: { type: Number }
}, { _id: false });

// Schema for module BOS prices
const ModuleBosPriceSchema = new mongoose.Schema({
  moduleCount: { type: Number, required: true },
  bosPrice: { type: Number, required: true }
}, { _id: false });

// Schema for KW profit margins
const KwProfitMarginSchema = new mongoose.Schema({
  minKw: { type: Number, required: true },
  maxKw: { type: Number, required: true },
  profitAmount: { type: Number, required: true }
}, { _id: false });

// Schema for insurance ranges
const InsuranceRangeSchema = new mongoose.Schema({
  minKw: { type: Number, required: true },
  maxKw: { type: Number, required: true },
  insurancePrice: { type: Number, required: true }
}, { _id: false });

// Schema for costs
const CostsSchema = new mongoose.Schema({
  // Standard costs
  bosPrice: { type: Number, default: 0 },
  adminCost: { type: Number, default: 0 },
  pipePrice: { type: Number, default: 0 },
  transportCost: { type: Number, default: 0 },
  commissionExpense: { type: Number, default: 0 },
  installationServiceCharges: { type: Number, default: 0 },
  profitMargin: { type: Number, default: 0 },
  maxDiscountPerKW: { type: Number, default: 0 },
  solarEfficiency: { type: Number, default: 0.3 },
  electricityRate: { type: Number, default: 0 },
  directSalesGST: { type: Number, default: 0 },
  gstRate: { type: Number, default: 0 },
  hiddenStandardCosts: { type: [String], default: [] },
  
  // Channel Partner settings
  channelPartnerProfitMargin: { type: Number, default: 0 },
  channelPartnerMinProfit: { type: Number, default: 0 },
  channelPartnerMaxDiscount: { type: Number, default: 0 },
  channelPartnerServiceCharge: { type: Number, default: 0 },
  channelPartnerMarketingFee: { type: Number, default: 0 },
  channelPartnerAdminCost: { type: Number, default: 0 },
  
  // Brand Associate settings
  brandAssociateDefaultProfit: { type: Number, default: 0 },
  brandAssociateMinProfit: { type: Number, default: 0 },
  brandAssociateMaxDiscount: { type: Number, default: 0 },
  brandAssociateSupportFee: { type: Number, default: 0 },
  brandAssociateBrandingFee: { type: Number, default: 0 },
  brandAssociateTrainingCost: { type: Number, default: 0 }
}, { _id: false });

// Schema for custom costs
const CustomCostSchema = new mongoose.Schema({
  id: { type: Number, required: true },
  name: { type: String, required: true },
  value: { type: Number, required: true },
  multiplyByKW: { type: Boolean, default: false },
  userType: {
    type: String,
    enum: ['User', 'All'],
    default: 'All'
  }
}, { _id: false });

// Schema for wire configurations
const WireConfigSchema = new mongoose.Schema({
  name: { type: String, required: true },
  length: { type: Number, required: true },
  price: { type: Number, required: true }
}, { _id: false });

// Schema for kit setting items
const KitSettingItemSchema = new mongoose.Schema({
  id: { type: String, required: true },
  type: { type: String, required: true },
  price: { type: Number, required: true },
  showInCalculator: { type: Boolean, default: true }
}, { _id: false });

// Schema for wire configurations (legacy)
const WireConfigLegacySchema = new mongoose.Schema({
  id: { type: Number, required: true },
  size: String,
  length: String,
  price: Number
});

// Kit Wire Configuration Schema - for kit calculator with default lengths
const KitWireConfigSchema = new mongoose.Schema({
  id: Number,
  size: String,
  defaultLength: String,  // Default length that admin sets
  price: Number,
  isDefault: { type: Boolean, default: false }  // Track which option is selected as default
});

// Legacy Kit Settings Schema (for backward compatibility)
const KitSettingsSchema = new mongoose.Schema({
  solarPanel: { type: [KitPanelSchema], default: [] },
  maxModuleCount: { type: Number },
  inverter: { type: [InverterSchema], default: [] },
  structure: { type: [StructureSchema], default: [] },
  nutBoltingStructures: { type: [NutBoltingStructureSchema], default: [] },
  // Map of kit front height -> direct sales front height reference
  nutBoltingFrontHeightRefs: {
    type: Map,
    of: Number,
    default: {}
  },
  acdb: { type: [KitSettingItemSchema], default: [] },
  dcdb: { type: [KitSettingItemSchema], default: [] },
  earthingKit: { type: [KitSettingItemSchema], default: [] },
  clamps: { type: [KitSettingItemSchema], default: [] },
  ssTie: { type: [KitSettingItemSchema], default: [] },
  wire: { type: [KitSettingItemSchema], default: [] },
  jBolt: { type: [KitSettingItemSchema], default: [] },
  uBolt: { type: [KitSettingItemSchema], default: [] },
  transport: {
    description: { type: String, default: '' },
    cost: { type: Number, default: 0 }
  },
  solarInsurance: {
    description: { type: String, default: '' },
    cost: { type: Number, default: 0 }
  },
  insuranceRanges: { type: [InsuranceRangeSchema], default: [] },
  wireConfigurations: {
    dcWireBlack: { type: [KitWireConfigSchema], default: [] },
    dcWireRed: { type: [KitWireConfigSchema], default: [] },
    acWireRed: { type: [KitWireConfigSchema], default: [] },
    acWireBlack: { type: [KitWireConfigSchema], default: [] },
    acWireBlue: { type: [KitWireConfigSchema], default: [] },
    acWireYellow: { type: [KitWireConfigSchema], default: [] },
    earthingWireGreen: { type: [KitWireConfigSchema], default: [] },
    laEarthingWireGreen: { type: [KitWireConfigSchema], default: [] }
  },
  marginPercentage: { type: Number, default: 0 },
  gstPercentage: { type: Number, default: 0 }
});

// Separate schemas for Kit and Direct Sales pricing
const KitPricingSchema = new mongoose.Schema({
  // All kit-specific settings from current kitSettings
  solarPanel: { type: [KitPanelSchema], default: [] },
  maxModuleCount: { type: Number },
  inverter: { type: [InverterSchema], default: [] },
  structure: { type: [StructureSchema], default: [] },
  showStructureSection: { type: Boolean, default: true },
  nutBoltingStructures: { type: [NutBoltingStructureSchema], default: [] },
  showNutBoltingSection: { type: Boolean, default: true },
  // Map of kit front height -> direct sales front height reference
  nutBoltingFrontHeightRefs: {
    type: Map,
    of: Number,
    default: {}
  },
  acdb: { type: [KitSettingItemSchema], default: [] },
  dcdb: { type: [KitSettingItemSchema], default: [] },
  earthingKit: { type: [KitSettingItemSchema], default: [] },
  clamps: { type: [KitSettingItemSchema], default: [] },
  ssTie: { type: [KitSettingItemSchema], default: [] },
  wire: { type: [KitSettingItemSchema], default: [] },
  jBolt: { type: [KitSettingItemSchema], default: [] },
  uBolt: { type: [KitSettingItemSchema], default: [] },
  transport: {
    description: { type: String, default: '' },
    cost: { type: Number, default: 0 }
  },
  solarInsurance: {
    description: { type: String, default: '' },
    cost: { type: Number, default: 0 }
  },
  insuranceRanges: { type: [InsuranceRangeSchema], default: [] },
  wireConfigurations: {
    dcWireBlack: { type: [KitWireConfigSchema], default: [] },
    dcWireRed: { type: [KitWireConfigSchema], default: [] },
    acWireRed: { type: [KitWireConfigSchema], default: [] },
    acWireBlack: { type: [KitWireConfigSchema], default: [] },
    acWireBlue: { type: [KitWireConfigSchema], default: [] },
    acWireYellow: { type: [KitWireConfigSchema], default: [] },
    earthingWireGreen: { type: [KitWireConfigSchema], default: [] },
    laEarthingWireGreen: { type: [KitWireConfigSchema], default: [] }
  },
  marginPercentage: { type: Number, default: 0 },
  gstPercentage: { type: Number, default: 0 },
  // Kit-specific accessories
  mountingAccessories: [{
    id: { type: Number, required: true },
    name: { type: String, required: true },
    qty: { type: Number, required: true },
    price: { type: Number, required: true },
    discount: { type: Number, default: 0 }
  }],
  structureAccessories: [{
    id: { type: Number, required: true },
    name: { type: String, required: true },
    qty: { type: Number, required: true },
    price: { type: Number, required: true }
  }],
  // Kit-specific PVC configurations
  pvcPipeConfigurations: [{
    diameterSize: { type: String, required: true },
    pipes: [{
      id: { type: Number, required: true },
      numberOfPipes: { type: Number, required: true },
      items: [{
        name: { type: String, required: true },
        quantity: { type: Number, required: true }
      }],
      price: { type: Number, default: 0 }
    }]
  }]
});

const DirectSalesPricingSchema = new mongoose.Schema({
  // Direct Sales components
  panels: [PanelSchema],
  inverters: [InverterSchema],
  structures: [StructureSchema],
  showStructureSection: { type: Boolean, default: true },
  nutBoltingStructures: [NutBoltingStructureSchema],
  showNutBoltingSection: { type: Boolean, default: true },
  moduleBosPrices: [ModuleBosPriceSchema],
  regularUserProfitMargins: [KwProfitMarginSchema],
  insuranceRanges: [InsuranceRangeSchema],
  costs: CostsSchema,
  customCosts: [CustomCostSchema],
  // Direct Sales wire configurations
  wireConfigurations: {
    dcWireBlack: { type: [WireConfigSchema], default: [] },
    dcWireRed: { type: [WireConfigSchema], default: [] },
    acWireRed: { type: [WireConfigSchema], default: [] },
    acWireBlack: { type: [WireConfigSchema], default: [] },
    acWireBlue: { type: [WireConfigSchema], default: [] },
    acWireYellow: { type: [WireConfigSchema], default: [] },
    earthingWireGreen: { type: [WireConfigSchema], default: [] },
    laEarthingWireGreen: { type: [WireConfigSchema], default: [] }
  },
  // Direct Sales PVC accessories
  pvcAccessories: [{
    id: { type: Number, required: true },
    name: { type: String, required: true },
    qty: { type: Number, required: true },
    price: { type: Number, required: true }
  }]
});

const PricingConfigSchema = new mongoose.Schema({
  location: {
    type: String,
    default: 'surat',
    required: true
  },
  // Separate pricing trees for Kit and Direct Sales
  kitPricing: {
    type: KitPricingSchema,
    default: () => ({})
  },
  directSalesPricing: {
    type: DirectSalesPricingSchema,
    default: () => ({})
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('PricingConfig', PricingConfigSchema);