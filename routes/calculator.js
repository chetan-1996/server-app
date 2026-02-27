  const express = require('express');
const router = express.Router();
const User = require('../models/User');
const CalculatorLog = require('../models/CalculatorLog');
const PricingConfig = require('../models/PricingConfig');

const ensureArray = (value) => (Array.isArray(value) ? value : []);

const hasNestedDirectSalesData = (directSalesPricing = {}) => {
  if (!directSalesPricing || typeof directSalesPricing !== 'object') {
    return false;
  }

  return (
    (Array.isArray(directSalesPricing.panels) && directSalesPricing.panels.length > 0) ||
    (Array.isArray(directSalesPricing.inverters) && directSalesPricing.inverters.length > 0) ||
    (Array.isArray(directSalesPricing.structures) && directSalesPricing.structures.length > 0) ||
    (Array.isArray(directSalesPricing.nutBoltingStructures) && directSalesPricing.nutBoltingStructures.length > 0) ||
    Object.keys(directSalesPricing.costs || {}).length > 0
  );
};

const extractDirectSalesConfig = (configDoc = {}) => {
  const buildConfigShape = (source = {}) => ({
    panels: ensureArray(source.panels),
    inverters: ensureArray(source.inverters),
    structures: ensureArray(source.structures),
    nutBoltingStructures: ensureArray(source.nutBoltingStructures),
    moduleBosPrices: ensureArray(source.moduleBosPrices),
    regularUserProfitMargins: ensureArray(source.regularUserProfitMargins),
    insuranceRanges: ensureArray(source.insuranceRanges),
    customCosts: ensureArray(source.customCosts),
    costs: source.costs || {}
  });

  if (hasNestedDirectSalesData(configDoc.directSalesPricing)) {
    const nested = buildConfigShape(configDoc.directSalesPricing);
    // If nested block is missing nut bolting, fall back to root (legacy) so DS-equivalent can price 3.2
    if ((!nested.nutBoltingStructures || nested.nutBoltingStructures.length === 0) && Array.isArray(configDoc.nutBoltingStructures)) {
      nested.nutBoltingStructures = ensureArray(configDoc.nutBoltingStructures);
    }
    return nested;
  }

  return buildConfigShape(configDoc);
};

// Calculate a Direct Sales equivalent price for Kit calculator inputs using
// the same pricing configuration that powers the direct sales calculator.
// This mirrors the Admin Kit Calculator's Direct Sales Equivalent Analysis
// so that we can persist the same breakdown into CalculatorLog for kit logs.
const calculateKitDirectSalesEquivalentPrice = (kitData, pricingConfigDoc) => {
  const isDsEquivalent = Boolean(kitData?._dsEquivalent);
  if (!pricingConfigDoc || !kitData) return null;

  // Normalize Mongoose document to plain object
  const configSource =
    typeof pricingConfigDoc.toObject === 'function' ? pricingConfigDoc.toObject() : pricingConfigDoc;

  // Reuse the direct sales config extractor so we always use the correct
  // direct sales pricing structure regardless of legacy/new storage format.
  const directSalesConfig = extractDirectSalesConfig(configSource);

  // Kit settings (solar panel / inverter / structure mappings) always come
  // from kitSettings or legacy kitPricing on the config document itself.
  const kitSettings = configSource.kitSettings || configSource.kitPricing || {};

  const pricingConfig = {
    ...directSalesConfig,
    kitSettings
  };

  const normalizeName = (value = '') => value.replace(/\s+/g, ' ').trim().toLowerCase();
  const ultraNormalize = (value = '') =>
    value.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '');

  // Helper to resolve kit panel config by name using kitSettings panels
  const findKitPanelConfig = (kitPanelName, kitPanels = []) => {
    if (!kitPanelName) return null;
    const normalizedKitPanel = kitPanelName.replace(/\s+/g, ' ').trim().toLowerCase();

    return (
      kitPanels.find(panel => panel && panel.name === kitPanelName) ||
      kitPanels.find(
        panel =>
          ((panel && panel.name) || '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase() === normalizedKitPanel
      )
    );
  };

  try {
    const { costs = {}, kitSettings: kitCfg = {} } = pricingConfig;
    const systemKW = parseFloat(kitData.systemKW) || 0;
    const moduleCount = parseInt(kitData.moduleCount, 10) || 0;

    if (systemKW <= 0 || moduleCount <= 0) {
      return { success: false, error: 'Invalid system data' };
    }

    // 1) Solar Panel Price (prefer Direct Sales panel via explicit mapping)
    const kitPanelName = (kitData.panelName || '').trim();
    const kitPanels = Array.isArray(kitCfg.solarPanel) ? kitCfg.solarPanel : [];

    let kitPanelConfig = findKitPanelConfig(kitPanelName, kitPanels);
    let selectedPanel = (pricingConfig.panels || []).find(panel => panel.name === kitPanelName);
    if (!selectedPanel && kitPanelName) {
      selectedPanel = (pricingConfig.panels || []).find(
        panel => normalizeName(panel.name) === normalizeName(kitPanelName)
      );
    }
    if (!selectedPanel && kitPanelConfig && kitPanelConfig.directSalesPanelId != null) {
      selectedPanel = (pricingConfig.panels || []).find(
        panel => panel.id === kitPanelConfig.directSalesPanelId
      );
    }
    if (!kitPanelConfig && selectedPanel) {
      kitPanelConfig = kitPanels.find(
        panel => panel && panel.directSalesPanelId != null && panel.directSalesPanelId === selectedPanel.id
      );
    }

    const panelPricePerWatt =
      (selectedPanel && selectedPanel.pricePerWatt) != null
        ? selectedPanel.pricePerWatt
        : kitPanelConfig && kitPanelConfig.pricePerWatt != null
        ? kitPanelConfig.pricePerWatt
        : 0;
    const panelWattage = parseFloat(kitData.panelWattage || 0);
    const modulePrice = panelPricePerWatt * panelWattage * moduleCount;

    // 2) Inverter Price (from Kit Calculator data but using Direct Sales inverter config)
    const kitInverterName = (kitData.solarInverterType || '').trim();
    const targetKW = parseFloat(kitData.solarInverterWatt) || 0;
    const kitInverters = Array.isArray(kitCfg.inverter) ? kitCfg.inverter : [];
    const inverters = Array.isArray(pricingConfig.inverters) ? pricingConfig.inverters : [];

    const findKitInverterConfig = () => {
      if (!kitInverterName) return null;
      return (
        kitInverters.find(inv => inv && inv.name === kitInverterName) ||
        kitInverters.find(inv => normalizeName(inv?.name || '') === normalizeName(kitInverterName))
      );
    };

    let kitInverterConfig = findKitInverterConfig();
    let selectedInverter = null;

    // Prefer explicit mapping via directSalesInverterId when available
    if (kitInverterConfig && kitInverterConfig.directSalesInverterId != null) {
      selectedInverter = inverters.find(
        inv => inv && String(inv.id) === String(kitInverterConfig.directSalesInverterId)
      );
    }

    // Fallback to direct name and fuzzy matching
    if (!selectedInverter && kitInverterName) {
      selectedInverter = inverters.find(
        inv => (inv && inv.name && inv.name.trim()) === kitInverterName
      );
    }
    if (!selectedInverter && kitInverterName) {
      const normalizedKitInverter = normalizeName(kitInverterName);
      selectedInverter = inverters.find(
        inv => normalizeName(inv?.name || '') === normalizedKitInverter
      );
    }
    if (!selectedInverter && kitInverterName) {
      const ultraKey = ultraNormalize(kitInverterName);
      selectedInverter = inverters.find(
        inv => ultraNormalize(inv?.name || '') === ultraKey
      );
    }

    // If we found a direct sales inverter but not the kit config, backfill it for completeness
    if (!kitInverterConfig && selectedInverter) {
      kitInverterConfig = kitInverters.find(
        inv =>
          inv &&
          inv.directSalesInverterId != null &&
          String(inv.directSalesInverterId) === String(selectedInverter.id)
      );
    }

    let inverterPrice = 0;

    const resolveInverterPrice = inverter => {
      if (!inverter || !Array.isArray(inverter.kwRatings) || inverter.kwRatings.length === 0) {
        return 0;
      }

      const exact = inverter.kwRatings.find(rating => rating.kw === targetKW);
      if (exact) return exact.price || 0;

      // Special-case: if a standard 4KW rating exists and target is in the 4–4.5KW band, reuse it
      const standardFourKW = inverter.kwRatings.find(rating => rating.kw === 4);
      if (standardFourKW && targetKW > 0 && targetKW <= 4.5) {
        return standardFourKW.price || 0;
      }

      // General nearest-match fallback
      const sorted = inverter.kwRatings
        .slice()
        .sort((a, b) => Math.abs(a.kw - targetKW) - Math.abs(b.kw - targetKW));

      return (sorted[0] && sorted[0].price) || 0;
    };

    if (selectedInverter) {
      inverterPrice = resolveInverterPrice(selectedInverter);
    } else if (targetKW > 0 && inverters.length > 0) {
      const inverterWithKW = inverters.find(
        inv => Array.isArray(inv.kwRatings) && inv.kwRatings.some(r => r.kw === targetKW)
      );

      if (inverterWithKW) {
        inverterPrice = resolveInverterPrice(inverterWithKW);
      } else {
        // As a last resort, use the first inverter's closest KW match
        inverterPrice = resolveInverterPrice(inverters[0]);
      }
    }

    // 3) BOS Price
    let bosPrice = (costs && costs.bosPrice) || 0;
    if (pricingConfig.moduleBosPrices && moduleCount) {
      const matchingBosPrice = pricingConfig.moduleBosPrices.find(
        item => item && item.moduleCount === moduleCount
      );
      if (matchingBosPrice) {
        bosPrice = matchingBosPrice.bosPrice;
      }
    }

    // 4) Structure Cost
    const pipePrice = (costs && costs.pipePrice) || 0;
    let structureCost = 0;
    let nutBoltingCost = 0;
    const structureBreakdown = [];

    const structureFields = Object.keys(kitData).filter(
      key => key.startsWith('structure_') && !key.includes('showStructure')
    );
    const hasStructureValues = structureFields.some(field => parseFloat(kitData[field]) > 0);

    if (Array.isArray(pricingConfig.structures) && structureFields.length > 0 && (kitData.showStructure || hasStructureValues)) {
      structureFields.forEach(fieldName => {
        const quantity = parseFloat(kitData[fieldName]) || 0;

        if (quantity > 0) {
          const structureNameFromField = fieldName.replace('structure_', '').replace(/_/g, ' ');
          const normalizedFieldStructure = normalizeName(structureNameFromField);

          const kitStructures = Array.isArray(kitCfg.structure) ? kitCfg.structure : [];
          const kitStructureConfig = kitStructures.find(
            s =>
              s &&
              (s.name === structureNameFromField ||
                normalizeName(s.name) === normalizedFieldStructure)
          );

          const dsStructures = Array.isArray(pricingConfig.structures)
            ? pricingConfig.structures
            : [];

          let matchingStructure = dsStructures.find(
            s => s && s.name === structureNameFromField
          );
          if (!matchingStructure && structureNameFromField) {
            matchingStructure = dsStructures.find(
              s => normalizeName(s.name) === normalizedFieldStructure
            );
          }
          if (!matchingStructure && kitStructureConfig && kitStructureConfig.directSalesStructureId != null) {
            matchingStructure = dsStructures.find(
              s => s && s.id === kitStructureConfig.directSalesStructureId
            );
          }

          // Additional robust name-based matching for common structure sizes
          if (!matchingStructure) {
            const normalizedKey = fieldName.toLowerCase();

            if (normalizedKey.includes('40x40x2')) {
              matchingStructure = dsStructures.find(struct => {
                const n = normalizeName(struct?.name || '');
                return n.includes('40x40x2') || n.includes('40*40*2');
              });
            } else if (normalizedKey.includes('60x40x2')) {
              matchingStructure = dsStructures.find(struct => {
                const n = normalizeName(struct?.name || '');
                return n.includes('60x40x2') || n.includes('60*40*2');
              });
            } else if (normalizedKey.includes('80x40x2')) {
              matchingStructure = dsStructures.find(struct => {
                const n = normalizeName(struct?.name || '');
                return n.includes('80x40x2') || n.includes('80*40*2');
              });
            } else {
              const normalizedField = normalizeName(structureNameFromField);
              matchingStructure = dsStructures.find(struct =>
                normalizeName(struct?.name || '').includes(normalizedField)
              );
            }
          }

          // Fallback to kit structure config if no direct sales match
          const structureSource = matchingStructure || kitStructureConfig;

          if (structureSource) {
            const kgPerPipe = Number(structureSource.pricePerUnit) || 0;
            const structurePipePrice =
              structureSource.pipePrice != null ? structureSource.pipePrice : pipePrice;
            const itemCost = kgPerPipe * structurePipePrice * quantity;
            structureCost += itemCost;
            structureBreakdown.push({
              name: structureSource.name,
              quantity,
              kgPerPipe,
              pipePrice: structurePipePrice,
              itemCost
            });
          }
        }
      });
    }

    // Nut Bolting Structure (3.2) - include in structure cost/breakdown for admin kit
    let nutBoltingItem = null;
    const nutBoltingSelection = kitData?.nutBoltingSelection;
    if (nutBoltingSelection && nutBoltingSelection.walkwayType) {
      const {
        walkwayType,
        frontHeight,
        panelCount,
        structureId,
        withWalkwayPrice,
        withoutWalkwayPrice,
        name: nbName
      } = nutBoltingSelection;
      const kitNutBoltingSources = [
        kitCfg?.nutBoltingStructures,
        configSource.kitSettings?.nutBoltingStructures,
        configSource.kitPricing?.nutBoltingStructures
      ]
        .filter(Boolean)
        .flat();

      const directSalesNutBoltingStructures = [
        directSalesConfig?.nutBoltingStructures,
        configSource?.nutBoltingStructures,
        configSource?.directSalesPricing?.nutBoltingStructures
      ]
        .filter(arr => Array.isArray(arr) && arr.length > 0)
        .flat();

      const frontHeightRefMap =
        kitCfg?.nutBoltingFrontHeightRefs ||
        configSource?.kitSettings?.nutBoltingFrontHeightRefs ||
        configSource?.kitPricing?.nutBoltingFrontHeightRefs ||
        {};

      // For KIT result pricing: use KIT nut bolting data only (no DS influence). DS refs remain available in selection for DS-equivalent.
      const kitStructureConfig = (() => {
        if (structureId !== undefined && structureId !== null) {
          return kitNutBoltingSources.find(s => String(s.id) === String(structureId));
        }
        if (frontHeight !== undefined && panelCount !== undefined) {
          return kitNutBoltingSources.find(
            s => Number(s.frontHeight) === Number(frontHeight) && Number(s.panelCount) === Number(panelCount)
          );
        }
        return null;
      })();

      // Direct Sales equivalent (for comparison) should use DS prices first.
      const dsStructureIdRef =
        kitStructureConfig?.directSalesStructureIdRef ?? nutBoltingSelection?.directSalesStructureIdRef;
      const dsFrontHeightRef =
        frontHeightRefMap[String(frontHeight)] ??
        kitStructureConfig?.directSalesFrontHeightRef ??
        nutBoltingSelection?.directSalesFrontHeightRef;

      const matchingDirectSales = (() => {
        if (!directSalesNutBoltingStructures.length) return null;

        if (dsStructureIdRef !== undefined && dsStructureIdRef !== null) {
          const byId = directSalesNutBoltingStructures.find(
            s => String(s.id) === String(dsStructureIdRef)
          );
          if (byId) return byId;
        }

        if (dsFrontHeightRef !== undefined && dsFrontHeightRef !== null && panelCount !== undefined) {
          const byRef = directSalesNutBoltingStructures.find(
            s => Number(s.frontHeight) === Number(dsFrontHeightRef) && Number(s.panelCount) === Number(panelCount)
          );
          if (byRef) return byRef;
        }

        if (dsFrontHeightRef !== undefined && dsFrontHeightRef !== null) {
          const byHeightAnyPanel = directSalesNutBoltingStructures.find(
            s => Number(s.frontHeight) === Number(dsFrontHeightRef)
          );
          if (byHeightAnyPanel) return byHeightAnyPanel;
        }

        if (frontHeight !== undefined && panelCount !== undefined) {
          const byKitHeightPanel = directSalesNutBoltingStructures.find(
            s => Number(s.frontHeight) === Number(frontHeight) && Number(s.panelCount) === Number(panelCount)
          );
          if (byKitHeightPanel) return byKitHeightPanel;
        }

        // Last resort: any DS nut bolting entry
        return directSalesNutBoltingStructures[0] || null;
      })();

      const kitWithPrice = Number.isFinite(Number(kitStructureConfig?.withWalkwayPrice))
        ? Number(kitStructureConfig.withWalkwayPrice)
        : Number.isFinite(Number(withWalkwayPrice))
          ? Number(withWalkwayPrice)
          : 0;

      const kitWithoutPrice = Number.isFinite(Number(kitStructureConfig?.withoutWalkwayPrice))
        ? Number(kitStructureConfig.withoutWalkwayPrice)
        : Number.isFinite(Number(withoutWalkwayPrice))
          ? Number(withoutWalkwayPrice)
          : 0;

      const dsWithPrice = Number.isFinite(Number(matchingDirectSales?.withWalkwayPrice))
        ? Number(matchingDirectSales.withWalkwayPrice)
        : 0;

      const dsWithoutPrice = Number.isFinite(Number(matchingDirectSales?.withoutWalkwayPrice))
        ? Number(matchingDirectSales.withoutWalkwayPrice)
        : 0;

      const dsResolvedPrice = walkwayType === 'without' ? dsWithoutPrice : dsWithPrice;
      const kitResolvedPrice = walkwayType === 'without' ? kitWithoutPrice : kitWithPrice;
      const resolvedPrice = isDsEquivalent ? dsResolvedPrice : kitResolvedPrice;

      if (Number.isFinite(resolvedPrice) && resolvedPrice >= 0) {
        structureCost += resolvedPrice;
        nutBoltingCost += (isDsEquivalent ? dsResolvedPrice : resolvedPrice);
        nutBoltingItem = {
          name: (isDsEquivalent ? matchingDirectSales?.name : null) || kitStructureConfig?.name || nbName || 'Nut Bolting Structure',
          quantity: 1,
          walkwayType: walkwayType || 'with',
          frontHeight: isDsEquivalent && matchingDirectSales?.frontHeight != null
            ? matchingDirectSales.frontHeight
            : (kitStructureConfig?.frontHeight ?? frontHeight),
          panelCount: isDsEquivalent && matchingDirectSales?.panelCount != null
            ? matchingDirectSales.panelCount
            : (panelCount ?? kitStructureConfig?.panelCount),
          price: isDsEquivalent ? dsResolvedPrice : resolvedPrice,
          itemCost: isDsEquivalent ? dsResolvedPrice : resolvedPrice
        };
        structureBreakdown.push(nutBoltingItem);
      }
    }

    // 5) Direct Sales additional costs
    const adminCost = ((costs && costs.adminCost) || 0) * systemKW;
    const installationCharges =
      ((costs && costs.installationServiceCharges) || 0) * systemKW;
    const transportCost = ((costs && costs.transportCost) || 0) * systemKW;
    const commissionExpense = ((costs && costs.commissionExpense) || 0) * systemKW;

    // 6) Insurance Cost
    let insuranceCost = 0;
    if (
      kitData.showSolarInsurance &&
      Array.isArray(pricingConfig.insuranceRanges) &&
      pricingConfig.insuranceRanges.length > 0
    ) {
      const matchingInsurance = pricingConfig.insuranceRanges.find(
        range => systemKW >= range.minKw && systemKW < range.maxKw
      );
      if (matchingInsurance) {
        insuranceCost = matchingInsurance.insurancePrice;
      }
    }

    // 7) Custom Costs
    let customCostTotal = 0;
    if (Array.isArray(pricingConfig.customCosts) && pricingConfig.customCosts.length > 0) {
      customCostTotal = pricingConfig.customCosts.reduce((total, cost) => {
        if (!cost) return total;
        const value = cost.value || 0;
        const costValue = cost.multiplyByKW ? value * systemKW : value;
        return total + costValue;
      }, 0);
    }

    // 8) Calculate base amount
    const baseAmount =
      modulePrice +
      inverterPrice +
      bosPrice +
      adminCost +
      installationCharges +
      transportCost +
      commissionExpense +
      structureCost +
      insuranceCost +
      customCostTotal;

    // 9) Get profit margin
    let profitMargin = (costs && costs.profitMargin) || 10;
    if (
      Array.isArray(pricingConfig.regularUserProfitMargins) &&
      pricingConfig.regularUserProfitMargins.length > 0
    ) {
      const matchingProfitMargin = pricingConfig.regularUserProfitMargins.find(
        range => systemKW >= range.minKw && systemKW < range.maxKw
      );
      if (matchingProfitMargin) {
        profitMargin = matchingProfitMargin.profitAmount;
      }
    }

    const finalProfitAmount = profitMargin * systemKW;
    const totalBeforeGST = baseAmount + finalProfitAmount;

    // 10) Calculate GST
    const rawGstPercentage = (costs && costs.gstRate) != null ? costs.gstRate : 13.8;
    const gstRate = rawGstPercentage / 100;
    const gstAmount = totalBeforeGST * gstRate;
    const totalWithGST = totalBeforeGST + gstAmount;

    // 11) Apply rounding logic (same custom rounding as calculators)
    const roundedPrice = Math.floor(totalWithGST / 100) * 100;
    const lastTwoDigits = Math.round(totalWithGST) % 100;
    const finalPrice = lastTwoDigits < 50 ? roundedPrice : roundedPrice + 100;

    return {
      success: true,
      modulePrice,
      inverterPrice,
      bosPrice,
      structureCost,
      adminCost,
      installationCharges,
      transportCost,
      commissionExpense,
      insuranceCost,
      customCostTotal,
      baseAmount,
      profitMargin,
      finalProfitAmount,
      totalBeforeGST,
      gstAmount,
      gstPercentage: rawGstPercentage,
      totalWithGST,
      finalPrice,
      structureBreakdown,
      nutBoltingCost
    };
  } catch (error) {
    console.error('Error in calculateKitDirectSalesEquivalentPrice:', error);
    return { success: false, error: error.message };
  }
};

// Updated function to calculate price based on user role with specific configurations
const calculatePriceByRole = (baseData, userRole, config) => {
  try {
    
    const { 
      systemKW,
      modulePrice,
      inverterPrice, 
      bosPrice,
      adminCost,
      installationCharges,
      transportCost,
      commissionExpense,
      insuranceCost,
      customCostTotal,
      // Structure input data
      structure1,
      structure2,
      structure3,
      structureInputs = [],
      nutBoltingSelection = null
    } = baseData;

  const { costs } = config;
  
  const normalizeQuantity = (value) => {
    const qty = parseFloat(value);
    return Number.isFinite(qty) ? qty : 0;
  };

  const hasNewStructureInputs = Array.isArray(structureInputs) && structureInputs.length > 0;
  const fallbackStructureInputs = [
    { id: config.structures?.[0]?.id, name: config.structures?.[0]?.name, quantity: structure1 },
    { id: config.structures?.[1]?.id, name: config.structures?.[1]?.name, quantity: structure2 },
    { id: config.structures?.[2]?.id, name: config.structures?.[2]?.name, quantity: structure3 }
  ].filter(entry => normalizeQuantity(entry.quantity) > 0);

  const normalizedStructureInputs = hasNewStructureInputs ? structureInputs : fallbackStructureInputs;

  let structureCost = 0;
  const structureBreakdown = [];
  let nutBoltingCost = 0;
  const nutBoltingBreakdown = [];
  if (Array.isArray(normalizedStructureInputs) && normalizedStructureInputs.length > 0 && Array.isArray(config.structures)) {
    normalizedStructureInputs.forEach(entry => {
      const quantity = normalizeQuantity(entry?.quantity ?? entry?.qty ?? entry?.value);
      if (quantity <= 0) return;

      const entryId = entry?.id ?? entry?.structureId;
      let matchingStructure = null;

      if (entryId !== undefined && entryId !== null) {
        matchingStructure = config.structures.find(struct => String(struct.id) === String(entryId));
      }

      if (!matchingStructure && entry?.name) {
        matchingStructure = config.structures.find(struct => struct.name === entry.name);
      }

      if (!matchingStructure) return;

      const kgPerPipe = matchingStructure.pricePerUnit || 0;
      const structurePipePrice = (matchingStructure.pipePrice ?? costs.pipePrice) || 0;
      const itemCost = structurePipePrice * kgPerPipe * quantity;
      structureCost += itemCost;
      structureBreakdown.push({
        name: matchingStructure.name,
        quantity,
        kgPerPipe,
        pipePrice: structurePipePrice,
        itemCost
      });
    });
  }

  // Add Nut Bolting Structure (with/without walkway) cost if provided (separate from regular structure)
  if (nutBoltingSelection) {
    const {
      walkwayType,
      frontHeight,
      panelCount,
      structureId,
      withWalkwayPrice,
      withoutWalkwayPrice,
      structureName
    } = nutBoltingSelection;
    const dsNutBoltingStructures = Array.isArray(config.nutBoltingStructures)
      ? config.nutBoltingStructures
      : [];

    let matchingNutBolting = null;
    if (structureId !== undefined && structureId !== null) {
      matchingNutBolting = dsNutBoltingStructures.find(s => String(s.id) === String(structureId));
    }
    if (!matchingNutBolting && frontHeight !== undefined && panelCount !== undefined) {
      matchingNutBolting = dsNutBoltingStructures.find(
        s =>
          Number(s.frontHeight) === Number(frontHeight) &&
          Number(s.panelCount) === Number(panelCount)
      );
    }

    // Prefer matched config; fall back to selection payload
    const withPrice = Number.isFinite(Number(matchingNutBolting?.withWalkwayPrice))
      ? Number(matchingNutBolting.withWalkwayPrice)
      : (Number.isFinite(Number(withWalkwayPrice)) ? Number(withWalkwayPrice) : 0);
    const withoutPrice = Number.isFinite(Number(matchingNutBolting?.withoutWalkwayPrice))
      ? Number(matchingNutBolting.withoutWalkwayPrice)
      : (Number.isFinite(Number(withoutWalkwayPrice)) ? Number(withoutWalkwayPrice) : 0);

    const resolvedPrice = walkwayType === 'without' ? withoutPrice : withPrice;

    if (Number.isFinite(resolvedPrice) && resolvedPrice > 0) {
      nutBoltingCost += resolvedPrice;
      nutBoltingBreakdown.push({
        name: matchingNutBolting?.name || structureName || 'Nut Bolting Structure',
        quantity: 1,
        walkwayType: walkwayType || 'with',
        frontHeight,
        panelCount,
        price: resolvedPrice,
        itemCost: resolvedPrice
      });
    }
  }
  
      // Calculate base amount (same for all user types)
    const baseAmount = modulePrice + inverterPrice + bosPrice + adminCost + 
                     installationCharges + transportCost + commissionExpense + 
                     structureCost + nutBoltingCost + insuranceCost + customCostTotal;
  
  // Get profit margin based on system KW and user type
  let profitMargin = costs.profitMargin || 10;
  let profitMargins = [];

  // Channel Partners get their discounts separately, but base calculation should be the same
  if (!userRole || userRole === 'User' || userRole === 'Admin' || userRole === 'BusinessAssociate' || 
      userRole === 'ChannelPartner' || userRole === 'ChannelPartnerBDM') {
    profitMargins = config.regularUserProfitMargins || [];
  }
  
  // Find matching profit margin for the system size
  if (profitMargins.length > 0) {
    const matchingProfitMargin = profitMargins.find(range => 
      systemKW >= range.minKw && systemKW < range.maxKw
    );
    
    if (matchingProfitMargin) {
      profitMargin = matchingProfitMargin.profitAmount;
    }
  }

  // Normal User calculation (default)
  if (!userRole || userRole === 'User' || userRole === 'Admin' || userRole === 'BusinessAssociate') {
    // Calculate profit amount
    const finalProfitAmount = profitMargin * systemKW;
    
    const totalBeforeGST = baseAmount + finalProfitAmount;
    
    return {
      totalBeforeGST,
      finalProfitAmount,
      additionalCosts: 0,
      maxDiscountPerKW: costs.maxDiscountPerKW || 100,
      roleType: 'normal',
      structureCost,
      structureBreakdown,
      nutBoltingSelection,
      nutBoltingCost,
      nutBoltingBreakdown
    };
  }
  
  // Channel Partner calculation (includes ChannelPartnerBDM) - Same as Regular Users for Direct Sales
  if (userRole === 'ChannelPartner' || userRole === 'ChannelPartnerBDM') {
    // Calculate profit amount (using same logic as Regular Users)
    const finalProfitAmount = profitMargin * systemKW;
    
    const totalBeforeGST = baseAmount + finalProfitAmount;
    
    return {
      totalBeforeGST,
      finalProfitAmount,
      additionalCosts: 0,
      maxDiscountPerKW: costs.channelPartnerMaxDiscount || 100,
      roleType: 'channelPartner',
      structureCost,
      structureBreakdown,
      nutBoltingSelection,
      nutBoltingCost,
      nutBoltingBreakdown
    };
  }
  
  // Default case
  return {
    totalBeforeGST: baseAmount,
    finalProfitAmount: 0,
    additionalCosts: 0,
    maxDiscountPerKW: costs.maxDiscountPerKW || 100,
    roleType: 'normal',
    structureCost,
    structureBreakdown,
    nutBoltingSelection,
    nutBoltingCost,
    nutBoltingBreakdown
  };
  
  } catch (error) {
    console.error('Error in calculatePriceByRole:', error);
    console.error('Error stack:', error.stack);
    console.error('User role:', userRole);
    console.error('Base data:', baseData);
    throw error; // Re-throw to be caught by main try-catch
  }
};

// Calculate solar system price
router.post('/calculate', async (req, res) => {
  try {
    
    const {
      userId,
      location = 'surat', // Default to surat location
      customerName,
      customerMobile,
      panelName,
      moduleCount,
      panelWattage,
      inverterName,
      inverterKW,
      structure1,
      structure2,
      structure3,
      structureInputs = [],
      nutBoltingSelection = null,
      includeInsurance = false,
      discountPerKW = 0,
      subsidy = 0
    } = req.body;
    
    // Validate required fields
    if (!userId || !panelName || !moduleCount || !panelWattage || !inverterName || !inverterKW) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    // Find user to get their role and allowed locations
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Check if user has access to this location (non-admin users only)
    const isAdminUser = typeof user.isAdmin === 'function' ? user.isAdmin() : user.role === 'Admin';
    if (!isAdminUser) {
      if (!user.allowedLocations || !user.allowedLocations.includes(location)) {
        return res.status(403).json({ message: `You don't have access to ${location} location calculator` });
      }
    }

    // Get pricing configuration for the selected location
    const configDoc = await PricingConfig.findOne({ location }).sort({ updatedAt: -1 });
    if (!configDoc) {
      return res.status(404).json({ message: `Pricing configuration not found for ${location}` });
    }

    // Normalize direct sales config regardless of legacy/new storage format
    const configSource = typeof configDoc.toObject === 'function' ? configDoc.toObject() : configDoc;
    const config = extractDirectSalesConfig(configSource);

    // Calculate system size in KW
    const systemKW = (moduleCount * panelWattage) / 1000;

    // Get base component prices
    
    const selectedPanel = config.panels?.find(p => p.name === panelName);
    const selectedInverter = config.inverters?.find(i => i.name === inverterName);

    if (!selectedPanel || !selectedInverter) {
      return res.status(400).json({ message: 'Invalid component selection' });
    }

    // Calculate panel price
    const modulePrice = selectedPanel.pricePerWatt * panelWattage * moduleCount;
    
    // Calculate inverter price
    let inverterPrice = 0;
    if (selectedInverter.kwRatings) {
      const kwRating = selectedInverter.kwRatings.find(r => r.kw === parseFloat(inverterKW));
      if (kwRating) {
        inverterPrice = kwRating.price;
      }
    }

    // BOS price based on module count
    let bosPrice = config.costs.bosPrice || 0;
    if (config.moduleBosPrices && moduleCount) {
      const matchingBosPrice = config.moduleBosPrices.find(item => item.moduleCount === parseInt(moduleCount));
      if (matchingBosPrice) {
        bosPrice = matchingBosPrice.bosPrice;
      }
    }
    
    // Admin cost = admin cost * system KW
    const adminCost = (config.costs.adminCost || 0) * systemKW;
    
    // Installation charges = installation charges * system KW
    const installationCharges = (config.costs.installationServiceCharges || 0) * systemKW;
    
    // Transport cost = transport cost * system KW
    const transportCost = (config.costs.transportCost || 0) * systemKW;
    
    // Commission expense = commission expense * system KW
    const commissionExpense = (config.costs.commissionExpense || 0) * systemKW;
    
    // Structure cost calculation is now handled inside calculatePriceByRole function
    // Each role calculates its own structure cost with its own pipe price
    
    // Insurance cost based on system KW
    let insuranceCost = 0;
    if (includeInsurance && config.insuranceRanges && config.insuranceRanges.length > 0) {
      const matchingInsuranceRange = config.insuranceRanges.find(
        item => systemKW >= item.minKw && systemKW < item.maxKw
      );
      
      if (matchingInsuranceRange) {
        insuranceCost = matchingInsuranceRange.insurancePrice;
      }
    }
    
    // Custom costs - only apply 'All' and 'User' type costs in the main calculation
    let customCostTotal = 0;
    if (config.customCosts && config.customCosts.length > 0) {
      // Filter costs to only include those applicable to all users or specifically to direct sales users
      const relevantCosts = config.customCosts.filter(cost => 
        cost.userType === 'User' || cost.userType === 'All'
      );
      
      customCostTotal = relevantCosts.reduce((total, cost) => {
        if (cost.multiplyByKW) {
          return total + (cost.value * systemKW);
        } else {
          return total + cost.value;
        }
      }, 0);
    }

    // Prepare base data for role-specific calculation
    const structureInputArray = Array.isArray(structureInputs) ? structureInputs.filter(item => item && item.quantity !== undefined) : [];

    const baseData = {
      systemKW,
      modulePrice,
      inverterPrice,
      bosPrice,
      adminCost,
      installationCharges,
      transportCost,
      commissionExpense,
      insuranceCost,
      customCostTotal,
      // Structure input data for role-specific calculation
      structure1,
      structure2,
      structure3,
      structureInputs: structureInputArray,
      nutBoltingSelection
    };

    // Calculate role-specific price
    const roleResults = calculatePriceByRole(baseData, user.role, config);
    const totalBeforeGST = roleResults.totalBeforeGST;
    const finalProfitAmount = roleResults.finalProfitAmount;
    const additionalCosts = roleResults.additionalCosts;
    const maxDiscountPerKW = roleResults.maxDiscountPerKW;
    const structureCost = roleResults.structureCost || 0;
    const structureBreakdown = Array.isArray(roleResults.structureBreakdown)
      ? roleResults.structureBreakdown
      : [];
    const nutBoltingCost = roleResults.nutBoltingCost || 0;
    const nutBoltingBreakdown = Array.isArray(roleResults.nutBoltingBreakdown)
      ? roleResults.nutBoltingBreakdown
      : [];
    const nutBoltingSelectionResult = roleResults.nutBoltingSelection || nutBoltingSelection;

    // GST calculation - use admin-configured GST rate
    const gstRate = (config.costs?.gstRate || 13.8) / 100; // Convert percentage to decimal
    const totalGST = totalBeforeGST * gstRate;
    
    // Final price with GST
    const finalPrice = totalBeforeGST + totalGST;
    
    // Custom rounding for the final price (round to nearest hundred)
    const roundedFinalPrice = Math.floor(finalPrice / 100) * 100;
    const lastTwoDigits = Math.round(finalPrice) % 100;
    const customRoundedFinalPrice = lastTwoDigits < 50 ? 
      roundedFinalPrice : 
      roundedFinalPrice + 100;

    // Apply discount if applicable
    let discountAmount = 0;
    let discountedFinalPrice = customRoundedFinalPrice;
    
    if (discountPerKW && systemKW > 0) {
      // Ensure discount doesn't exceed max allowed for user role
      const appliedDiscountPerKW = Math.min(
        parseFloat(discountPerKW), 
        maxDiscountPerKW
      );
      
      // Calculate total discount based on system KW
      discountAmount = Math.round(appliedDiscountPerKW * systemKW);
      
      // Apply discount to final price
      const rawDiscountedPrice = Math.max(0, customRoundedFinalPrice - discountAmount);
      
      // Apply the same custom rounding to the discounted price
      const discountedRoundedPrice = Math.floor(rawDiscountedPrice / 100) * 100;
      const discountedLastTwoDigits = Math.round(rawDiscountedPrice) % 100;
      discountedFinalPrice = discountedLastTwoDigits < 50 ? 
        discountedRoundedPrice : 
        discountedRoundedPrice + 100;
    }

    // Create calculation log
    const calculatorLog = new CalculatorLog({
      userId: user._id,
      username: user.username,
      name: user.name || user.username,
      role: user.role,
      calculationDate: new Date(),
      inputData: {
        customerName,
        customerMobile,
        panelName,
        moduleCount,
        panelWattage,
        systemKW,
        inverterName,
        inverterKW,
        structure1,
        structure2,
        structure3,
        discountPerKW,
        subsidy,
        location
      },
      results: {
        modulePrice,
        inverterPrice,
        bosPrice,
        adminCost,
        installationCharges,
        transportCost,
        commissionExpense,
        structureCost,
        structureBreakdown,
        nutBoltingSelection: nutBoltingSelectionResult,
        nutBoltingCost,
        nutBoltingBreakdown,
        insuranceCost,
        customCostTotal,
        profitMargin: finalProfitAmount,
        additionalRoleCosts: additionalCosts,
        totalBeforeGST,
        totalGST,
        finalPrice: customRoundedFinalPrice,
        discountAmount,
        discountedFinalPrice,
        roleType: roleResults.roleType
      }
    });

    await calculatorLog.save();

    // DUAL CALCULATION LOGIC FOR BRAND ASSOCIATES AND CHANNEL PARTNERS
    let brandAssociateValue = null;
    let channelPartnerValue = null;
    let regularUserPrice = null;
    let brandAssociatePrice = null;
    let channelPartnerPrice = null;
    
    // STEP 1: Always calculate Direct Sales price (using direct sales profit margins and costs)
    const regularUserResults = calculatePriceByRole(baseData, 'User', config);
    
    // Calculate direct sales price with GST and rounding
    const regularUserTotalBeforeGST = regularUserResults.totalBeforeGST;
    const regularUserTotalGST = regularUserTotalBeforeGST * gstRate;
    const regularUserFinalPrice = regularUserTotalBeforeGST + regularUserTotalGST;
    
    // Apply the same custom rounding
    const regularUserRoundedPrice = Math.floor(regularUserFinalPrice / 100) * 100;
    const regularUserLastTwoDigits = Math.round(regularUserFinalPrice) % 100;
    regularUserPrice = regularUserLastTwoDigits < 50 ? 
      regularUserRoundedPrice : 
      regularUserRoundedPrice + 100;
    
    // STEP 2: Calculate Brand Associate/Channel Partner specific prices and values
    if (user.role === 'BrandAssociatedUser') {
      // For Brand Associates: 
      // Step 2 calculation already done (customRoundedFinalPrice uses Brand Associate profit margins)
      brandAssociatePrice = customRoundedFinalPrice;
      
      // Brand Value = Direct Sales Price - Brand Associate Price
      brandAssociateValue = Math.max(0, regularUserPrice - brandAssociatePrice);
      
    } else if (user.role === 'ChannelPartner' || user.role === 'ChannelPartnerBDM') {
      // For Channel Partners and Channel Partner BDMs:
      // Step 2 calculation already done (customRoundedFinalPrice uses Channel Partner profit margins)
      channelPartnerPrice = customRoundedFinalPrice;
      
      // Channel Value = Direct Sales Price - Channel Partner Price  
      channelPartnerValue = Math.max(0, regularUserPrice - channelPartnerPrice);
      
    } else {
      // For Direct Sales Users or Admins: Calculate both values for comparison
      
      // Calculate Brand Associate price using their specific profit margins from admin panel
      const brandAssociateResults = calculatePriceByRole(baseData, 'BrandAssociatedUser', config);
      const brandAssociateTotalBeforeGST = brandAssociateResults.totalBeforeGST;
      const brandAssociateTotalGST = brandAssociateTotalBeforeGST * gstRate;
      const brandAssociateFinalPrice = brandAssociateTotalBeforeGST + brandAssociateTotalGST;
      
      const brandAssociateRoundedPrice = Math.floor(brandAssociateFinalPrice / 100) * 100;
      const brandAssociateLastTwoDigits = Math.round(brandAssociateFinalPrice) % 100;
      brandAssociatePrice = brandAssociateLastTwoDigits < 50 ? 
        brandAssociateRoundedPrice : 
        brandAssociateRoundedPrice + 100;
      
      brandAssociateValue = Math.max(0, regularUserPrice - brandAssociatePrice);
      
      // Calculate Channel Partner price using their specific profit margins from admin panel
      const channelPartnerResults = calculatePriceByRole(baseData, 'ChannelPartner', config);
      const channelPartnerTotalBeforeGST = channelPartnerResults.totalBeforeGST;
      const channelPartnerTotalGST = channelPartnerTotalBeforeGST * gstRate;
      const channelPartnerFinalPrice = channelPartnerTotalBeforeGST + channelPartnerTotalGST;
      
      const channelPartnerRoundedPrice = Math.floor(channelPartnerFinalPrice / 100) * 100;
      const channelPartnerLastTwoDigits = Math.round(channelPartnerFinalPrice) % 100;
      channelPartnerPrice = channelPartnerLastTwoDigits < 50 ? 
        channelPartnerRoundedPrice : 
        channelPartnerRoundedPrice + 100;
      
      channelPartnerValue = Math.max(0, regularUserPrice - channelPartnerPrice);
    }
    
    // Debug logging for Brand Associate responses
    if (user.role === 'BrandAssociatedUser') {
      // Brand Associate specific logic
    }
    
    res.json({
      success: true,
      results: {
        systemKW,
        modulePrice,
        inverterPrice,
        bosPrice,
        structureCost,
        structureBreakdown,
        // expose nut bolting details for user-facing PDF (section 3.2)
        nutBoltingSelection: nutBoltingSelectionResult,
        nutBoltingCost,
        nutBoltingBreakdown,
        adminCost,
        installationCharges,
        transportCost,
        commissionExpense,
        insuranceCost,
        customCostTotal,
        profitMargin: finalProfitAmount,
        additionalRoleCosts: additionalCosts,
        totalBeforeGST,
        totalGST,
        finalPrice: customRoundedFinalPrice,
        discountAmount,
        discountedFinalPrice,
        maxDiscountPerKW,
        roleType: roleResults.roleType,
        userRole: user.role,
        // Dual calculation results
        brandAssociateValue,
        channelPartnerValue,
        regularUserPrice,
        brandAssociatePrice,
        channelPartnerPrice
      }
    });

  } catch (error) {
    console.error("Calculator API error:", error);
    console.error("Error stack:", error.stack);
    console.error("Request body:", req.body);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Kit Calculator endpoint - uses kit settings for pricing
router.post('/kit-calculate', async (req, res) => {
  try {
    const {
      userId,
      location = 'surat', // Default to surat location
      userRole,
      userName,
      kitCalculationData
    } = req.body;

    // Find user to get their role and allowed locations
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Check if user has access to this location (skip check for admin users)
    const isAdminUser = typeof user.isAdmin === 'function' ? user.isAdmin() : user.role === 'Admin';
    if (!isAdminUser && (!user.allowedLocations || !user.allowedLocations.includes(location))) {
      return res.status(403).json({ message: `You don't have access to ${location} location calculator` });
    }

    // Get pricing configuration for the selected location
    const config = await PricingConfig.findOne({ location }).sort({ updatedAt: -1 });
    if (!config) {
      return res.status(404).json({ message: `Pricing configuration not found for ${location}` });
    }

    const normalizedLocation = (location || 'surat').toLowerCase();
    const defaultPricingLocation = (process.env.DEFAULT_PRICING_LOCATION || 'surat').toLowerCase();
    let defaultLocationConfig = null;

    if (normalizedLocation === defaultPricingLocation) {
      defaultLocationConfig = config;
    } else {
      defaultLocationConfig = await PricingConfig.findOne({ location: defaultPricingLocation }).sort({ updatedAt: -1 });
      if (!defaultLocationConfig) {
        console.warn('[KitCalculator] Default pricing location config not found', { defaultPricingLocation });
      }
    }

    // Normalize configs to plain objects for nested directSalesPricing access
    const configPlain = typeof config.toObject === 'function' ? config.toObject() : config;
    const defaultLocationPlain = defaultLocationConfig
      ? (typeof defaultLocationConfig.toObject === 'function' ? defaultLocationConfig.toObject() : defaultLocationConfig)
      : null;

    const directSalesConfig = extractDirectSalesConfig(configPlain);
    const defaultDirectSalesConfig = defaultLocationPlain ? extractDirectSalesConfig(defaultLocationPlain) : null;

    // Extract data from kitCalculationData
    const systemKW = parseFloat(kitCalculationData.systemKW) || 0;

    // Validate that required kit calculation data exists
    if (!kitCalculationData.panelName || !kitCalculationData.panelWattage || !kitCalculationData.moduleCount) {
      return res.status(400).json({ message: 'Missing required solar panel data' });
    }

    if (!kitCalculationData.solarInverterType || !kitCalculationData.solarInverterWatt) {
      return res.status(400).json({ message: 'Missing required inverter data' });
    }

    // Ensure kit settings exist either on current or default location (legacy or kitPricing)
    const hasKitConfig =
      (config.kitSettings || config.kitPricing) ||
      (defaultLocationConfig?.kitSettings || defaultLocationConfig?.kitPricing);

    if (!hasKitConfig) {
      return res.status(500).json({ message: 'Kit settings not configured. Please contact administrator.' });
    }

    const findFirstMatching = (sources = [], predicate = () => false) => {
      for (const source of sources) {
        if (Array.isArray(source) && source.length > 0) {
          const match = source.find(predicate);
          if (match) {
            return match;
          }
        }
      }
      return null;
    };

    // Initialize all point costs
    let point1_solarPanelCost = 0;
    let point2_inverterCost = 0;
    let point3_structureCost = 0;
    let point4_protectionDeviceCost = 0;
    let point5_earthingKitCost = 0;
    let point6_wiringCost = 0;
    let point7_pvcPipeCost = 0;
    let point8_mountingAccessoriesCost = 0;
    let point9_structureAccessoriesCost = 0;
    let point10_transportCost = 0;
    let point11_solarInsuranceCost = 0;

    // Initialize detailed breakdown data
    let point1_breakdown = { pricePerWatt: 0, calculation: 'Not calculated' };
    let point2_breakdown = { unitPrice: 0, calculation: 'Not calculated' };
    let point3_breakdown = { items: [] };
    let point4_breakdown = { acdbPrice: 0, dcdbPrice: 0 };
    let point6_breakdown = { wireTypes: [] };
    let point7_breakdown = { pipeSize: '', numberOfPipes: 0, pricePerPipe: 0 };
    let point8_breakdown = { accessories: [] };
    let point9_breakdown = { accessories: [] };
    let point10_breakdown = { costPerKW: 0 };
    let point11_breakdown = { insuranceRange: '', unitPrice: 0 };
    let nutBoltingItem = null;
    let point3_2_nutBoltingCost = 0;

    // POINT 1: Solar Panel - Use EXACT same logic as direct sales calculator
    if (kitCalculationData.panelName && kitCalculationData.panelWattage && kitCalculationData.moduleCount) {
      // Sanitize panel name by trimming whitespace and tab characters
      const cleanPanelName = kitCalculationData.panelName.trim();
      const solarPanelSources = [
        { label: 'kitPricing.current', data: config.kitPricing?.solarPanel },
        { label: 'kitSettings.current', data: config.kitSettings?.solarPanel },
        { label: 'legacy.panels.current', data: config.panels },
        { label: 'kitPricing.default', data: defaultLocationConfig?.kitPricing?.solarPanel },
        { label: 'kitSettings.default', data: defaultLocationConfig?.kitSettings?.solarPanel },
        { label: 'legacy.panels.default', data: defaultLocationConfig?.panels }
      ];

      let selectedPanel = null;
      let selectedSourceLabel = null;
      for (const source of solarPanelSources) {
        if (!Array.isArray(source.data) || source.data.length === 0) continue;
        const match = source.data.find(p => p.name === cleanPanelName);
        if (match) {
          selectedPanel = match;
          selectedSourceLabel = source.label;
          break;
        }
      }

      if (selectedPanel && selectedPanel.pricePerWatt) {
        
        // Use EXACT same calculation as direct sales: pricePerWatt * panelWattage * moduleCount
        const pricePerWatt = selectedPanel.pricePerWatt;
        const panelWattage = parseInt(kitCalculationData.panelWattage);
        const moduleCount = parseInt(kitCalculationData.moduleCount);
        
        // This is EXACTLY how direct sales calculates: selectedPanel.pricePerWatt * panelWattage * moduleCount
        point1_solarPanelCost = pricePerWatt * panelWattage * moduleCount;
        
        
        // Store breakdown data
        point1_breakdown = {
          pricePerWatt: pricePerWatt,
          calculation: `${panelWattage}W × ${moduleCount} modules × ₹${pricePerWatt}/watt = ₹${point1_solarPanelCost.toLocaleString()}`
        };
      } else {
      }
    }

    // POINT 2: Inverter - Use kit settings or fallback to direct sales inverters
    if (kitCalculationData.solarInverterType && kitCalculationData.solarInverterWatt) {
      const inverterSources = [
        config.kitPricing?.inverter,
        config.kitSettings?.inverter,
        defaultLocationConfig?.kitPricing?.inverter,
        defaultLocationConfig?.kitSettings?.inverter,
        config.inverters,
        defaultLocationConfig?.inverters
      ];

      const selectedInverter = findFirstMatching(inverterSources, i => i.name === kitCalculationData.solarInverterType);
      
      if (selectedInverter) {
        const kwRating = selectedInverter.kwRatings?.find(k => k.kw == kitCalculationData.solarInverterWatt);
        if (kwRating) {
          point2_inverterCost = kwRating.price;
          
          // Store breakdown data
          point2_breakdown = {
            unitPrice: kwRating.price,
            calculation: `${kitCalculationData.solarInverterWatt}KW × 1 unit × ₹${kwRating.price.toLocaleString()} = ₹${point2_inverterCost.toLocaleString()}`
          };
        }
      }
    }

    // Prepare reusable sources for additional sections
    const structureSources = [
      config.kitPricing?.structure,
      config.kitSettings?.structure,
      defaultLocationConfig?.kitPricing?.structure,
      defaultLocationConfig?.kitSettings?.structure,
      config.structures,
      defaultLocationConfig?.structures
    ];

    const acdbSources = [
      config.kitPricing?.acdb,
      config.kitSettings?.acdb,
      defaultLocationConfig?.kitPricing?.acdb,
      defaultLocationConfig?.kitSettings?.acdb
    ];

    const dcdbSources = [
      config.kitPricing?.dcdb,
      config.kitSettings?.dcdb,
      defaultLocationConfig?.kitPricing?.dcdb,
      defaultLocationConfig?.kitSettings?.dcdb
    ];

    const earthingKitSources = [
      config.kitPricing?.earthingKit,
      config.kitSettings?.earthingKit,
      defaultLocationConfig?.kitPricing?.earthingKit,
      defaultLocationConfig?.kitSettings?.earthingKit
    ];

    const getFirstNonEmptyArray = (sources = []) => {
      for (const arr of sources) {
        if (Array.isArray(arr) && arr.length > 0) {
          return arr;
        }
      }
      return [];
    };

    const findStructureConfig = (nameVariants = []) => {
      for (const variant of nameVariants) {
        if (!variant) continue;
        const match = findFirstMatching(structureSources, s => s.name && s.name.trim() === variant.trim());
        if (match) {
          return match;
        }
      }
      return null;
    };

    // POINT 3: Structure - Modified logic: Price × Quantity × Pipe Price
    // Build structure entries from payload even if showStructure is false (for pre-filled selections)
    const structureEntries = kitCalculationData.structureDetails
      ? (Array.isArray(kitCalculationData.structureDetails)
          ? kitCalculationData.structureDetails
          : Object.entries(kitCalculationData.structureDetails).map(([key, qty]) => ({
              key,
              quantity: qty,
              directSalesStructureId: kitCalculationData.structureDetails[key]?.directSalesStructureId
            })))
      : [];

    const hasStructureEntries = Array.isArray(structureEntries) && structureEntries.length > 0;

    if (hasStructureEntries) {
      structureEntries.forEach(entry => {
        const quantity = parseFloat(entry?.quantity) || 0;
        if (quantity <= 0) return;

        let structureConfig = null;
        let resolvedName = entry?.name;

        if (entry?.directSalesStructureId !== undefined && entry?.directSalesStructureId !== null) {
          structureConfig = findFirstMatching(structureSources, s => String(s.id) === String(entry.directSalesStructureId));
        }

        if (!structureConfig) {
          if (entry?.kitStructureId !== undefined && entry?.kitStructureId !== null) {
            structureConfig = findFirstMatching(structureSources, s => String(s.id) === String(entry.kitStructureId));
          }
        }

        if (!structureConfig) {
          const key = typeof entry.key === 'string' ? entry.key : '';
          let structureName = '';
          if (key.startsWith('structure_')) {
            structureName = key.replace('structure_', '').replace(/_+$/, '').replace(/_/g, ' ');
          } else if (key.startsWith('structure')) {
            structureName = key.replace('structure', '');
          } else if (entry?.name) {
            structureName = entry.name;
          }
          resolvedName = resolvedName || structureName;

          const alternativeNames = [
            structureName,
            structureName?.replace(/x/g, '*') + ' mm',
            structureName?.replace(/x/g, '*'),
            structureName?.replace(/mm$/, ''),
            structureName?.replace(/mm$/, ' mm'),
            key.replace('structure_', '')
          ].filter(Boolean);

          structureConfig = findStructureConfig(alternativeNames);
        } else if (!resolvedName) {
          resolvedName = structureConfig?.name;
        }

        const structurePrice =
          entry?.pricePerUnit ??
          structureConfig?.pricePerUnit ??
          structureConfig?.price ??
          0;
        // For Direct Sales equivalent, prefer DS pipe price; avoid using kit entry pipePrice which is per-length
        const pipePrice =
          structureConfig?.pipePrice ??
          costs.pipePrice ??
          entry?.pipePrice ??
          1;

        if (structurePrice > 0) {
          const itemCost = structurePrice * quantity * pipePrice;
          point3_structureCost += itemCost;
          point3_breakdown.items.push({
            name: structureConfig?.name || resolvedName || 'Structure',
            quantity,
            pricePerUnit: structurePrice,
            pipePrice,
            itemCost,
            pipeLengthPrice: pipePrice,
            structureUnitPrice: structurePrice
          });
        }
      });
    }

    // POINT 3.2: Nut Bolting Structure (with/without walkway) — kit pricing only
    const nutBoltingSelection = kitCalculationData?.nutBoltingSelection;
    if (nutBoltingSelection && nutBoltingSelection.walkwayType) {
      const {
        walkwayType,
        frontHeight,
        panelCount,
        structureId,
        withWalkwayPrice,
        withoutWalkwayPrice,
        name: nbName
      } = nutBoltingSelection;

      const kitNutBoltingSources = [
        configPlain.kitSettings?.nutBoltingStructures,
        configPlain.kitPricing?.nutBoltingStructures,
        defaultLocationPlain?.kitSettings?.nutBoltingStructures,
        defaultLocationPlain?.kitPricing?.nutBoltingStructures
      ]
        .filter(Boolean)
        .flat();

      const kitStructureConfig = (() => {
        if (structureId !== undefined && structureId !== null) {
          return kitNutBoltingSources.find(s => String(s.id) === String(structureId));
        }
        if (frontHeight !== undefined && panelCount !== undefined) {
          return kitNutBoltingSources.find(
            s => Number(s.frontHeight) === Number(frontHeight) && Number(s.panelCount) === Number(panelCount)
          );
        }
        return null;
      })();

      const kitWithPrice = Number.isFinite(Number(kitStructureConfig?.withWalkwayPrice))
        ? Number(kitStructureConfig.withWalkwayPrice)
        : (Number.isFinite(Number(withWalkwayPrice)) ? Number(withWalkwayPrice) : 0);

      const kitWithoutPrice = Number.isFinite(Number(kitStructureConfig?.withoutWalkwayPrice))
        ? Number(kitStructureConfig.withoutWalkwayPrice)
        : (Number.isFinite(Number(withoutWalkwayPrice)) ? Number(withoutWalkwayPrice) : 0);

      const resolvedPrice = walkwayType === 'without' ? kitWithoutPrice : kitWithPrice;

      if (Number.isFinite(resolvedPrice) && resolvedPrice >= 0) {
        point3_2_nutBoltingCost += resolvedPrice;
        nutBoltingItem = {
          name: kitStructureConfig?.name || nbName || 'Nut Bolting Structure',
          quantity: 1,
          walkwayType: walkwayType || 'with',
          frontHeight: kitStructureConfig?.frontHeight ?? frontHeight,
          panelCount: kitStructureConfig?.panelCount ?? panelCount,
          price: resolvedPrice,
          itemCost: resolvedPrice
        };
      }
    }

    // POINT 4: Protection Device - Fetch price for ACDB + DCDB
    if (kitCalculationData.acdbType) {
      const acdbConfig = findFirstMatching(acdbSources, a => a.type === kitCalculationData.acdbType);
      if (acdbConfig) {
        point4_protectionDeviceCost += acdbConfig.price;
        point4_breakdown.acdbPrice = acdbConfig.price;
      }
    }

    if (kitCalculationData.dcdbType) {
      const dcdbConfig = findFirstMatching(dcdbSources, d => d.type === kitCalculationData.dcdbType);
      if (dcdbConfig) {
        point4_protectionDeviceCost += dcdbConfig.price;
        point4_breakdown.dcdbPrice = dcdbConfig.price;
      }
    }

    // POINT 5: Earthing Kit - Add all earthing kit items when section is enabled
    if (kitCalculationData.showEarthingKit) {
      const earthingKits = getFirstNonEmptyArray(earthingKitSources).filter(e => e.showInCalculator);
      earthingKits.forEach(earthingKit => {
        if (earthingKit.price) {
          point5_earthingKitCost += earthingKit.price;
        }
      });
    }

    // POINT 6: Wiring - Calculate for all sub-sections (6.1, 6.2, 6.3, etc.)
    const findWireConfigForSize = (wireType, size) => {
      if (!size) return null;

      const wireSources = [
        config.kitSettings?.wireConfigurations,
        config.kitPricing?.wireConfigurations,
        config.wireConfigurations,
        defaultLocationConfig?.kitSettings?.wireConfigurations,
        defaultLocationConfig?.kitPricing?.wireConfigurations,
        defaultLocationConfig?.wireConfigurations
      ];

      for (const source of wireSources) {
        const wireList = source?.[wireType];
        if (Array.isArray(wireList) && wireList.length > 0) {
          const matchedConfig = wireList.find(w => w.size === size);
          if (matchedConfig) {
            return matchedConfig;
          }
        }
      }
      return null;
    };

    const collectAvailableSizes = (wireConfigObj, wireType) => (
      Array.isArray(wireConfigObj?.[wireType])
        ? wireConfigObj[wireType].map(w => w.size)
        : []
    );

    if (kitCalculationData.showWiring && kitCalculationData.wiringDetails) {
      Object.entries(kitCalculationData.wiringDetails).forEach(([wireType, details]) => {
        if (details.size) {
          const wireConfig = findWireConfigForSize(wireType, details.size);

          if (!wireConfig) {
            console.warn('[KitCalculator][Wiring] No config found for wire', {
              wireType,
              requestedSize: details.size,
              availableKitSettings: collectAvailableSizes(config.kitSettings?.wireConfigurations, wireType),
              availableKitPricing: collectAvailableSizes(config.kitPricing?.wireConfigurations, wireType),
              availableLegacy: collectAvailableSizes(config.wireConfigurations, wireType),
              fallbackKitSettings: collectAvailableSizes(defaultLocationConfig?.kitSettings?.wireConfigurations, wireType),
              fallbackKitPricing: collectAvailableSizes(defaultLocationConfig?.kitPricing?.wireConfigurations, wireType),
              fallbackLegacy: collectAvailableSizes(defaultLocationConfig?.wireConfigurations, wireType)
            });
          }

          if (wireConfig) {
            // Calculate cost: length × price per unit
            const rawLength = details.length || wireConfig.defaultLength || wireConfig.length;
            const length = parseFloat(rawLength) || 0;

            if (!length) {
              console.warn('[KitCalculator][Wiring] Length missing for wire, skipping', {
                wireType,
                size: details.size,
                providedLength: details.length,
                fallbackLength: wireConfig.defaultLength || wireConfig.length || null
              });
              return;
            }

            const pricePerUnit = wireConfig.price || 0;
            const wireCost = length * pricePerUnit;
            point6_wiringCost += wireCost;

            
            
            // Store breakdown data
            point6_breakdown.wireTypes.push({
              wireType: wireType.replace(/([A-Z])/g, ' $1').toLowerCase(),
              size: details.size,
              length: length,
              pricePerMeter: pricePerUnit,
              wireCost: wireCost,
              calculation: `${length}m × ₹${pricePerUnit}/m = ₹${wireCost.toLocaleString()}`
            });
          }
        }
      });
    }

    // POINT 7: PVC Pipe with Accessories - Only use normal price (not pipe price)
    if (kitCalculationData.showPvcPipe && kitCalculationData.pvcPipeDetails) {
      const normalizePipeSize = (value = '') => value.replace(/^diameter[:\-\s]*/i, '').trim();
      const rawPipeSize = kitCalculationData.pvcPipeDetails.pvcPipeSize;
      const pvcPipeSize = normalizePipeSize(rawPipeSize);
      const { pvcPipeNumber } = kitCalculationData.pvcPipeDetails;


      if (pvcPipeSize && pvcPipeNumber) {
        const pvcConfigurations = (Array.isArray(config.pvcPipeConfigurations) && config.pvcPipeConfigurations.length > 0)
          ? config.pvcPipeConfigurations
          : (config.kitPricing?.pvcPipeConfigurations || []);

        if (!pvcConfigurations || pvcConfigurations.length === 0) {
          console.warn('[KitCalculator][PVC] No PVC configurations found for location:', location);
        }

        const pvcConfig = pvcConfigurations.find(p => normalizePipeSize(p.diameterSize) === pvcPipeSize);
        if (!pvcConfig) {
          console.warn('[KitCalculator][PVC] No diameter match found', { pvcPipeSize, available: pvcConfigurations.map(cfg => cfg.diameterSize) });
        }

        if (pvcConfig && pvcConfig.pipes && pvcConfig.pipes.length > 0) {
          // Find matching pipe configuration or use the first one
          const pipeConfig = pvcConfig.pipes.find(pipe => pipe.numberOfPipes === parseInt(pvcPipeNumber)) || 
                            pvcConfig.pipes[0];

          if (!pipeConfig) {
            console.warn('[KitCalculator][PVC] No pipe config match found. Falling back to first entry.', {
              pvcPipeNumber,
              availablePipeCounts: pvcConfig.pipes.map(pipe => pipe.numberOfPipes)
            });
          }

          if (pipeConfig) {
            // Use only the unit price, not multiplied by quantity
            point7_pvcPipeCost = pipeConfig.price;

            
            // Store breakdown data
            point7_breakdown = {
              pipeSize: pvcPipeSize,
              numberOfPipes: parseInt(pvcPipeNumber),
              pricePerPipe: pipeConfig.price,
              calculation: `${pvcPipeNumber} pipes × ₹${pipeConfig.price.toLocaleString()}/pipe`
            };
          }
        }
      } else {
        console.warn('[KitCalculator][PVC] pvcPipeSize or pvcPipeNumber missing despite section enabled', {
          pvcPipeSize,
          pvcPipeNumber
        });
      }
    }

    // POINT 8: Mounting Accessories - Multiply Price × Quantity for each item
    if (kitCalculationData.showMountingAccessories) {
      // Resolve mounting accessories from kitPricing/kitSettings (current or default location)
      const mountingAccessoriesSources = [
        config.kitPricing?.mountingAccessories,
        config.kitSettings?.mountingAccessories,
        defaultLocationConfig?.kitPricing?.mountingAccessories,
        defaultLocationConfig?.kitSettings?.mountingAccessories
      ];

      const mountingAccessories = getFirstNonEmptyArray(mountingAccessoriesSources);

      if (mountingAccessories.length > 0) {
        mountingAccessories.forEach(accessory => {
          const quantity = accessory.qty || 1; // Default to 1 if not set
          const itemCost = accessory.price * quantity;
          point8_mountingAccessoriesCost += itemCost;
          
          // Store breakdown data
          point8_breakdown.accessories.push({
            name: accessory.name,
            category: 'mounting',
            price: accessory.price,
            quantity: quantity,
            itemCost: itemCost,
            calculation: `${quantity} units × ₹${accessory.price.toLocaleString()}/unit = ₹${itemCost.toLocaleString()}`
          });
        });
      }
    }

    // POINT 9: Structure Accessories - Only calculate selected accessories
    if (kitCalculationData.showStructureAccessories && kitCalculationData.selectedStructureAccessories && kitCalculationData.selectedStructureAccessories.length > 0) {
      const moduleCount = parseInt(kitCalculationData.moduleCount) || 0;
      const selectedAccessories = kitCalculationData.selectedStructureAccessories;

      // Resolve structure accessories from kitPricing/kitSettings (current or default location)
      const structureAccessoriesSources = [
        config.kitPricing?.structureAccessories,
        config.kitSettings?.structureAccessories,
        defaultLocationConfig?.kitPricing?.structureAccessories,
        defaultLocationConfig?.kitSettings?.structureAccessories
      ];

      const structureAccessories = getFirstNonEmptyArray(structureAccessoriesSources);
      
      // Process all J bolt types with per-panel calculation (only if selected)
      const jBoltTypes = ['J bolt 40x40', 'J bolt 60x40', 'J bolt 80x40'];
      jBoltTypes.forEach(jBoltType => {
        if (selectedAccessories.includes(jBoltType)) {
          const jBoltAccessory = structureAccessories.find(a => a.name === jBoltType);
          if (jBoltAccessory && moduleCount > 0) {
            const boltsPerPanel = 4; // Fixed quantity: 4 bolts per panel
            const totalBolts = boltsPerPanel * moduleCount;
            const accessoryCost = totalBolts * jBoltAccessory.price;
            point9_structureAccessoriesCost += accessoryCost;
            
            // Store breakdown data
            point9_breakdown.accessories.push({
              name: jBoltAccessory.name,
              quantity: totalBolts,
              unitPrice: jBoltAccessory.price,
              accessoryCost: accessoryCost,
              calculation: `${boltsPerPanel} bolts/panel × ${moduleCount} panels × ₹${jBoltAccessory.price.toLocaleString()}/bolt = ₹${accessoryCost.toLocaleString()}`
            });
          }
        }
      });
      
      // Process other structure accessories if they exist and are selected
      if (structureAccessories.length > 0) {
        structureAccessories.forEach(accessory => {
          if (!jBoltTypes.includes(accessory.name) && selectedAccessories.includes(accessory.name)) {
            // Other accessories are added directly with their configured quantity
            const accessoryCost = accessory.price * (accessory.qty || 1);
            point9_structureAccessoriesCost += accessoryCost;
            
            // Store breakdown data
            point9_breakdown.accessories.push({
              name: accessory.name,
              quantity: accessory.qty || 1,
              unitPrice: accessory.price,
              accessoryCost: accessoryCost,
              calculation: `${accessory.qty || 1} units × ₹${accessory.price.toLocaleString()}/unit = ₹${accessoryCost.toLocaleString()}`
            });
          }
        });
      }
    }

    // POINT 10: Transport - Multiply transport price by KW (System Size)
    if (kitCalculationData.showTransport && config.kitSettings?.transport && systemKW > 0) {
      const transportCostPerKW = parseFloat(config.kitSettings.transport.cost) || 0;
      point10_transportCost = transportCostPerKW * systemKW;
      
      // Store breakdown data
      point10_breakdown = {
        costPerKW: transportCostPerKW,
        calculation: `${systemKW} KW × ₹${transportCostPerKW.toLocaleString()}/KW = ₹${point10_transportCost.toLocaleString()}`
      };
    }

    // POINT 11: Solar Insurance - Based on KW range from kit insurance settings
    if (kitCalculationData.showSolarInsurance && systemKW > 0) {
      const insuranceSources = [
        { label: 'kitPricing.current', data: config.kitPricing?.insuranceRanges },
        { label: 'kitSettings.current', data: config.kitSettings?.insuranceRanges },
        { label: 'kitPricing.default', data: defaultLocationConfig?.kitPricing?.insuranceRanges },
        { label: 'kitSettings.default', data: defaultLocationConfig?.kitSettings?.insuranceRanges }
      ];

      let insuranceRange = null;
      let insuranceSourceLabel = null;
      for (const source of insuranceSources) {
        if (!Array.isArray(source.data) || source.data.length === 0) continue;
        const match = source.data.find(range => systemKW >= range.minKw && systemKW < range.maxKw);
        if (match) {
          insuranceRange = match;
          insuranceSourceLabel = source.label;
          break;
        }
      }


      if (insuranceRange) {
        point11_solarInsuranceCost = insuranceRange.insurancePrice;
        
        // Store breakdown data
        point11_breakdown = {
          insuranceRange: `${insuranceRange.minKw}KW - ${insuranceRange.maxKw}KW`,
          unitPrice: insuranceRange.insurancePrice,
          calculation: `For ${systemKW}KW system (${insuranceRange.minKw}KW-${insuranceRange.maxKw}KW range) = ₹${point11_solarInsuranceCost.toLocaleString()}`
        };
      }
    }



    const hasStructureItemsForSubtotal = Array.isArray(point3_breakdown.items) && point3_breakdown.items.length > 0;

    // Calculate subtotal of all points (only count checked points)
    let subtotalBeforeMargin = 0;
    if (kitCalculationData.panelName) subtotalBeforeMargin += point1_solarPanelCost;
    if (kitCalculationData.solarInverterType) subtotalBeforeMargin += point2_inverterCost;
    if (kitCalculationData.showStructure || hasStructureItemsForSubtotal) subtotalBeforeMargin += point3_structureCost;
    if (nutBoltingItem) subtotalBeforeMargin += point3_2_nutBoltingCost;
    if (kitCalculationData.acdbType || kitCalculationData.dcdbType) subtotalBeforeMargin += point4_protectionDeviceCost;
    if (kitCalculationData.showEarthingKit) subtotalBeforeMargin += point5_earthingKitCost;
    if (kitCalculationData.showWiring) subtotalBeforeMargin += point6_wiringCost;
    if (kitCalculationData.showPvcPipe) subtotalBeforeMargin += point7_pvcPipeCost;
    if (kitCalculationData.showMountingAccessories) subtotalBeforeMargin += point8_mountingAccessoriesCost;
    if (kitCalculationData.showStructureAccessories) subtotalBeforeMargin += point9_structureAccessoriesCost;
    if (kitCalculationData.showTransport) subtotalBeforeMargin += point10_transportCost;
    if (kitCalculationData.showSolarInsurance) subtotalBeforeMargin += point11_solarInsuranceCost;

    const kitSettingsSources = [
      { label: 'kitPricing.current', data: config.kitPricing },
      { label: 'kitSettings.current', data: config.kitSettings },
      { label: 'kitPricing.default', data: defaultLocationConfig?.kitPricing },
      { label: 'kitSettings.default', data: defaultLocationConfig?.kitSettings }
    ];

    const findNumericSetting = (key) => {
      for (const source of kitSettingsSources) {
        const value = source.data?.[key];
        if (value !== undefined && value !== null && !isNaN(parseFloat(value))) {
          return { source: source.label, value: parseFloat(value) };
        }
      }
      return { source: null, value: 0 };
    };

    // MARGIN CALCULATION (Point 12)
    const { source: marginSource, value: marginPercentage } = findNumericSetting('marginPercentage');
    const marginAmount = (subtotalBeforeMargin * marginPercentage) / 100;
    const subtotalAfterMargin = subtotalBeforeMargin + marginAmount;


    // GST CALCULATION (Point 13) - Apply to value after margin
    const { source: gstSource, value: gstPercentage } = findNumericSetting('gstPercentage');
    const gstAmount = (subtotalAfterMargin * gstPercentage) / 100;
    const finalTotal = subtotalAfterMargin + gstAmount;


    // Validate that finalTotal is a valid number
    if (isNaN(finalTotal) || !isFinite(finalTotal)) {
      console.error('Invalid finalTotal:', finalTotal);
      return res.status(400).json({ message: 'Calculation error: Invalid final total. Please check your input data.' });
    }

    // Custom rounding
    const roundedTotal = Math.floor(finalTotal / 100) * 100;
    const lastTwoDigits = Math.round(finalTotal) % 100;
    const customRoundedFinalPrice = lastTwoDigits < 50 ? roundedTotal : roundedTotal + 100;

    // Calculate Direct Sales equivalent price and Channel Partner profit
    // using the same logic as the Admin Kit Calculator's Direct Sales
    // Equivalent Analysis. This will be stored in CalculatorLog so that
    // the logs modal can show the same comparative analysis.
    let directSalesEquivalent = null;
    let channelPartnerProfit = null;

    try {
      // Build kit data payload compatible with
      // calculateKitDirectSalesEquivalentPrice helper
      const kitDataForDirectSales = {
        ...kitCalculationData,
        showSolarInsurance: kitCalculationData.showSolarInsurance
        , _dsEquivalent: true
      };

      // Reconstruct structure_ keys from structureDetails so that the
      // helper can resolve structure pricing exactly like the admin UI
      if (Array.isArray(kitCalculationData.structureDetails)) {
        kitCalculationData.structureDetails.forEach(entry => {
          if (entry && entry.key && entry.quantity !== undefined && entry.quantity !== null) {
            kitDataForDirectSales[entry.key] = entry.quantity;
          }
        });
      }

      const dsResult = calculateKitDirectSalesEquivalentPrice(kitDataForDirectSales, config);

      if (dsResult && dsResult.success) {
        directSalesEquivalent = {
          ...dsResult,
          nutBoltingCost: Number.isFinite(dsResult.nutBoltingCost) ? dsResult.nutBoltingCost : 0,
          structureBreakdown: Array.isArray(dsResult.structureBreakdown) ? dsResult.structureBreakdown : []
        };

        const kitFinalPrice = customRoundedFinalPrice || 0;
        const directSalesFinalPrice = dsResult.finalPrice || 0;
        const profit = directSalesFinalPrice - kitFinalPrice;
        const profitPercentage = kitFinalPrice > 0 ? (profit / kitFinalPrice) * 100 : 0;

        channelPartnerProfit = {
          kitPrice: kitFinalPrice,
          directSalesPrice: directSalesFinalPrice,
          profit,
          profitPercentage
        };
      }
    } catch (err) {
      console.error('[KitCalculator] Direct Sales equivalent calculation failed:', err);
      directSalesEquivalent = null;
      channelPartnerProfit = null;
    }

    // Create detailed breakdown for each point using calculated data
    const detailedBreakdown = {
      point1_solarPanel: {
        title: "1. Solar Panel",
        panelName: kitCalculationData.panelName || 'Not selected',
        wattage: parseInt(kitCalculationData.panelWattage) || 0,
        moduleCount: parseInt(kitCalculationData.moduleCount) || 0,
        pricePerWatt: point1_breakdown.pricePerWatt,
        calculation: point1_breakdown.calculation,
        subtotal: point1_solarPanelCost
      },
      point2_inverter: {
        title: "2. Solar Inverter",
        inverterType: kitCalculationData.solarInverterType || 'Not selected',
        inverterWatt: kitCalculationData.solarInverterWatt || 0,
        quantity: 1,
        unitPrice: point2_breakdown.unitPrice,
        calculation: point2_breakdown.calculation,
        subtotal: point2_inverterCost
      },
      point3_structure: {
        title: "3. Structure",
        enabled: kitCalculationData.showStructure || false,
        items: point3_breakdown.items,
        structureItems: point3_breakdown.items,
        subtotal: point3_structureCost
      },
      point3_2_nutBolting: nutBoltingItem ? {
        title: "3.2 Nut Bolting Structure",
        enabled: true,
        item: nutBoltingItem,
        subtotal: point3_2_nutBoltingCost || 0
      } : null,
      point4_protectionDevice: {
        title: "4. Protection Device",
        acdb: kitCalculationData.acdbType || 'Not selected',
        dcdb: kitCalculationData.dcdbType || 'Not selected',
        acdbPrice: point4_breakdown.acdbPrice,
        dcdbPrice: point4_breakdown.dcdbPrice,
        calculation: `ACDB: ₹${point4_breakdown.acdbPrice.toLocaleString()} + DCDB: ₹${point4_breakdown.dcdbPrice.toLocaleString()}`,
        subtotal: point4_protectionDeviceCost
      },
      point5_earthingKit: {
        title: "5. Earthing Kit",
        enabled: kitCalculationData.showEarthingKit || false,
        earthingKitType: kitCalculationData.earthingKitType || 'Not selected',
        unitPrice: point5_earthingKitCost,
        calculation: `1 unit × ₹${point5_earthingKitCost.toLocaleString()}`,
        subtotal: point5_earthingKitCost
      },
      point6_wiring: {
        title: "6. Wiring",
        enabled: kitCalculationData.showWiring || false,
        wireTypes: point6_breakdown.wireTypes,
        subtotal: point6_wiringCost
      },
      point7_pvcPipe: {
        title: "7. PVC Pipe with Accessories",
        enabled: kitCalculationData.showPvcPipe || false,
        pipeSize: point7_breakdown.pipeSize,
        numberOfPipes: point7_breakdown.numberOfPipes,
        pricePerPipe: point7_breakdown.pricePerPipe,
        calculation: point7_breakdown.calculation,
        subtotal: point7_pvcPipeCost
      },
      point8_mountingAccessories: {
        title: "8. Mounting Accessories",
        enabled: kitCalculationData.showMountingAccessories || false,
        accessories: point8_breakdown.accessories,
        subtotal: point8_mountingAccessoriesCost
      },
      point9_structureAccessories: {
        title: "9. Structure Accessories",
        enabled: kitCalculationData.showStructureAccessories || false,
        accessories: point9_breakdown.accessories,
        subtotal: point9_structureAccessoriesCost
      },
      point10_transport: {
        title: "10. Transport",
        enabled: kitCalculationData.showTransport || false,
        systemKW: systemKW,
        costPerKW: point10_breakdown.costPerKW,
        calculation: point10_breakdown.calculation,
        subtotal: point10_transportCost
      },
      point11_insurance: {
        title: "11. Solar Insurance",
        enabled: kitCalculationData.showSolarInsurance || false,
        systemKW: systemKW,
        insuranceRange: point11_breakdown.insuranceRange,
        unitPrice: point11_breakdown.unitPrice,
        calculation: point11_breakdown.calculation,
        subtotal: point11_solarInsuranceCost
      }
    };

    // Create kit calculation result
    const structureBreakdown = Array.isArray(point3_breakdown.items)
      ? point3_breakdown.items
      : [];

    const kitResults = {
      kitCalculationType: userRole,
      customerName: kitCalculationData.customerName,
      customerMobile: kitCalculationData.customerMobile,
      customerAddress: kitCalculationData.customerAddress,
      
      // Individual point costs
      solarPanelCost: point1_solarPanelCost,
      solarInverterCost: point2_inverterCost,
      structureCost: point3_structureCost,
      nutBoltingCost: point3_2_nutBoltingCost,
      protectionDeviceCost: point4_protectionDeviceCost,
      earthingKitCost: point5_earthingKitCost,
      wiringCost: point6_wiringCost,
      pvcPipeCost: point7_pvcPipeCost,
      mountingAccessoriesCost: point8_mountingAccessoriesCost,
      structureAccessoriesCost: point9_structureAccessoriesCost,
      transportCost: point10_transportCost,
      solarInsuranceCost: point11_solarInsuranceCost,
      structureBreakdown,
      nutBoltingSelection: nutBoltingItem
        ? {
            frontHeight: nutBoltingItem.frontHeight,
            panelCount: nutBoltingItem.panelCount,
            walkwayType: nutBoltingItem.walkwayType,
            structureName: nutBoltingItem.name,
            price: nutBoltingItem.price
          }
        : null,
      
      // Detailed breakdown for frontend display
      detailedBreakdown,
      // Direct Sales equivalent analysis (for logs & admin comparison)
      directSalesEquivalent: directSalesEquivalent || undefined,
      channelPartnerProfit: channelPartnerProfit || undefined,
      
      // Calculation breakdown
      subtotalBeforeMargin,
      marginPercentage,
      marginAmount,
      subtotalAfterMargin,
      gstPercentage,
      gst: gstAmount,
      totalWithGST: customRoundedFinalPrice,
      
      // Kit details for reference
      kitDetails: {
        solarPanel: {
          panelName: kitCalculationData.panelName,
          wattage: kitCalculationData.panelWattage,
          moduleCount: kitCalculationData.moduleCount,
          systemKW: kitCalculationData.systemKW
        },
        solarInverter: {
          type: kitCalculationData.solarInverterType,
          watt: kitCalculationData.solarInverterWatt,
          qty: 1
        },
        structure: kitCalculationData.structureDetails || {},
        protectionDevice: {
          acdb: kitCalculationData.acdbType,
          dcdb: kitCalculationData.dcdbType
        },
        earthingKit: kitCalculationData.earthingKitType,
        wiring: kitCalculationData.wiringDetails || {},
        pvcPipe: kitCalculationData.pvcPipeDetails || {},
        mountingAccessories: kitCalculationData.mountingAccessories || {},
        structureAccessories: kitCalculationData.structureAccessories || {},
        transport: config.kitSettings?.transport?.description || 'Transport cost calculated',
        solarInsurance: `Solar Insurance for ${systemKW} KW system`
      },
      
      timestamp: new Date().toISOString(),
      calculationId: `kit_${Date.now()}`
    };

    // Log the kit calculation
    const kitCalculatorLog = new CalculatorLog({
      userId: user._id,
      username: user.username,
      name: user.name || user.username,
      role: user.role,
      calculationDate: new Date(),
      inputData: {
        calculationType: 'kit',
        customerName: kitCalculationData.customerName,
        customerMobile: kitCalculationData.customerMobile,
        customerAddress: kitCalculationData.customerAddress,
        panelName: kitCalculationData.panelName,
        panelWattage: kitCalculationData.panelWattage,
        moduleCount: kitCalculationData.moduleCount,
        systemKW: kitCalculationData.systemKW,
        solarInverterType: kitCalculationData.solarInverterType,
        solarInverterWatt: kitCalculationData.solarInverterWatt,
        structureDetails: kitCalculationData.structureDetails,
        acdbType: kitCalculationData.acdbType,
        dcdbType: kitCalculationData.dcdbType,
        earthingKitType: kitCalculationData.earthingKitType,
        selectedSections: {
          structure: kitCalculationData.showStructure,
          earthingKit: kitCalculationData.showEarthingKit,
          wiring: kitCalculationData.showWiring,
          pvcPipe: kitCalculationData.showPvcPipe,
          mountingAccessories: kitCalculationData.showMountingAccessories,
          structureAccessories: kitCalculationData.showStructureAccessories,
          transport: kitCalculationData.showTransport,
          solarInsurance: kitCalculationData.showSolarInsurance
        },
        location
      },
      results: {
        calculationType: 'kit',
        systemKW: parseFloat(kitCalculationData.systemKW),
        pointBreakdown: {
          point1_solarPanel: point1_solarPanelCost,
          point2_inverter: point2_inverterCost,
          point3_structure: point3_structureCost,
          point4_protectionDevice: point4_protectionDeviceCost,
          point5_earthingKit: point5_earthingKitCost,
          point6_wiring: point6_wiringCost,
          point7_pvcPipe: point7_pvcPipeCost,
          point8_mountingAccessories: point8_mountingAccessoriesCost,
          point9_structureAccessories: point9_structureAccessoriesCost,
          point10_transport: point10_transportCost,
          point11_solarInsurance: point11_solarInsuranceCost
        },
        detailedBreakdown,
        directSalesEquivalent: directSalesEquivalent || undefined,
        channelPartnerProfit: channelPartnerProfit || undefined,
        subtotalBeforeMargin,
        marginPercentage,
        marginAmount,
        subtotalAfterMargin,
        gstPercentage,
        gstAmount,
        finalPrice: customRoundedFinalPrice,
        roleType: 'kit'
      }
    });

    await kitCalculatorLog.save();

    res.json({
      success: true,
      results: kitResults
    });

  } catch (error) {
    console.error("Kit Calculator API error:", error);
    console.error("Error details:", error.message);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router; 

