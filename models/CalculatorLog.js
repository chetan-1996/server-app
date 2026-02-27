const mongoose = require('mongoose');

const CalculatorLogSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  username: {
    type: String,
    required: true
  },
  name: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: ['Admin', 'User', 'ChannelPartner', 'ChannelPartnerBDM', 'BusinessAssociate'],
    required: true
  },
  calculationDate: {
    type: Date,
    default: Date.now
  },
  inputData: {
    calculationType: String,
    // Customer Information
    customerName: String,
    customerMobile: String,
    customerAddress: String,
    
    // Solar Panel Details
    panelName: String,
    moduleCount: Number,
    panelWattage: Number,
    systemKW: Number,
    
    // Inverter Details
    inverterName: String,
    inverterKW: Number,
    solarInverterType: String,
    solarInverterWatt: Number,
    
    // Structure Details
    structureInputs: [
      {
        id: Number,
        name: String,
        quantity: Number
      }
    ],
    structureDetails: [
      {
        name: String,
        quantity: Number,
        key: String,
        directSalesStructureId: Number,
        kitStructureId: Number,
        pricePerUnit: Number,
        pipePrice: Number
      }
    ],
    acdbType: String,
    dcdbType: String,
    earthingKitType: String,
    selectedSections: {
      structure: Boolean,
      earthingKit: Boolean,
      wiring: Boolean,
      pvcPipe: Boolean,
      mountingAccessories: Boolean,
      structureAccessories: Boolean,
      transport: Boolean,
      solarInsurance: Boolean
    },
    
    // Financial Details
    discountPerKW: Number,
    customerPrice: Number,
    subsidy: Number,
    
    // Legacy fields for backward compatibility
    monthlyBill: Number,
    sanctionedLoad: Number,
    rooftopArea: Number,
    selectedPanel: String,
    selectedWattage: Number,
    selectedInverter: String,
    selectedInverterKW: Number,
    selectedStructure: String,
    discountPercentage: Number,
    location: String
  },
  results: {
    // Core calculation results
    modulePrice: Number,
    inverterPrice: Number,
    bosPrice: Number,
    adminCost: Number,
    installationCharges: Number,
    transportCost: Number,
    commissionExpense: Number,
    structureCost: Number,
    insuranceCost: Number,
    customCostTotal: Number,
    structureBreakdown: [
      {
        name: String,
        quantity: Number,
        kgPerPipe: Number,
        pipePrice: Number,
        itemCost: Number
      }
    ],
    
    // Role-specific fields
    profitMargin: Number, // Final profit amount after applying role-specific calculations
    additionalRoleCosts: Number, // Additional costs specific to the role (brand associate or channel partner)
    roleType: {
      type: String,
      enum: ['normal', 'brandAssociate', 'channelPartner', 'kit'],
      default: 'normal'
    },
    
    calculationType: String,
    systemKW: Number,
    pointBreakdown: mongoose.Schema.Types.Mixed,
    detailedBreakdown: mongoose.Schema.Types.Mixed,
    directSalesEquivalent: mongoose.Schema.Types.Mixed,
    channelPartnerProfit: mongoose.Schema.Types.Mixed,
    subtotalBeforeMargin: Number,
    
    marginPercentage: Number,
    marginAmount: Number,
    subtotalAfterMargin: Number,
    gstPercentage: Number,
    gstAmount: Number,
    
    // Financial results
    totalBeforeGST: Number,
    totalGST: Number,
    finalPrice: Number,
    discountAmount: Number,
    discountedFinalPrice: Number,
    
    // Additional calculated fields
    systemSizeKW: String,
    dailyEnergyKWh: String,
    annualEnergyKWh: String,
    annualSavings: String,
    totalCost: String,
    subsidizedCost: String,
    discountedCost: String,
    hasDiscount: Boolean,
    paybackPeriod: String,
    
    priceDetails: {
      modulePrice: Number,
      inverterPrice: Number,
      bosPrice: Number,
      adminCost: Number,
      installationCharges: Number,
      profitMargin: Number,
      transportCost: Number,
      commissionExpense: Number,
      structureCost: Number,
      insuranceCost: Number,
      totalBeforeGST: Number,
      flatGST: Number,
      finalPrice: Number,
      maxDiscountPerKW: Number,
      discountAmount: Number,
      discountedFinalPrice: Number
    },
    
    // Legacy fields for backward compatibility
    systemSize: Number,
    monthlyGeneration: Number,
    savings: Number,
    environmentalBenefit: Number,
    panelPrice: Number,
    structurePrice: Number,
    totalBOSCost: Number,
    subtotal: Number,
    totalDiscount: Number,
    totalSubsidy: Number,
    roleDiscount: {
      type: Number,
      default: 0
    },
    pricePerKW: Number
  },
  syncedToSheet: {
    type: Boolean,
    default: false
  }
});

module.exports = mongoose.model('CalculatorLog', CalculatorLogSchema);