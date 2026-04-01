const MATERIAL_ICON_OVERRIDES: Record<string, string> = {
  "Ale": "Ale",
  "Amenities": "BasicAmenities",
  "Advanced Amenities": "AdvancedAmenities",
  "Bio-Nutrient Blend": "NutrientBlend",
  "Nutrient Blend": "NutrientBlend",
  "Chickens": "Chicken",
  "Cows": "Cow",
  "Copper": "CopperBar",
  "Copper Wire": "CopperWiring",
  "Electric Motor": "Motor",
  "Ethanol": "Gasoline",
  "Hull Plate": "BasicHullPlate",
  "Iron": "IronBar",
  "Prefab Kit": "BasicPrefabKit",
  "Modern Prefab Kit": "ModernPrefabKit",
  "Advanced Prefab Kit": "AdvancedPrefabKit",
  "Field Cooling System": "FieldCooling",
  "Field Cooling": "FieldCooling",
  "TiC Drill": "AdvancedDrill",
  "Titanium Carbide Drill": "AdvancedDrill",
  "APU": "APU",
  "Advanced Processing Unit": "APU",
  "Advanced Tools": "AdvancedTools",
  "Adv. Tools": "AdvancedTools",
  "AI": "AI",
  "Artificial Intelligence": "AI",
  "Research": "ResearchData",
  "Advanced Research": "AdvancedResearchData",
  "Apex Research": "ApexResearchData",
  "Quantum Research": "QuantumResearchData",
  "Research Data": "ResearchData",
  "Advanced Research Data": "AdvancedResearchData",
  "Adv. Research Data": "AdvancedResearchData",
  "Apex Research Data": "ApexResearchData",
  "Quantum Research Data": "QuantumResearchData",
  "Graphenium Wire": "Superconductors",
  "SuperCoil": "HyperCoil",
  "Superconducting Coil": "HyperCoil",
  "Starglass Hull Plate": "QuadraniumHullPlate",
  "Molecular Fusion Kit": "WeldingKit2",
  "Hydrogen Fuel": "HydrogenFuelCell",
  "Ship Repair Kit": "ShipRepairKit",
  "Linear FTL Emitter": "BasicFTLEmitter",
  "Quantum FTL Emitter": "AdvancedFTLEmitter",
  "Extra-dimensional FTL Emitter": "SuperiorFTLEmitter",
  "Shuttle Bridge": "BasicShipBridge",
  "Hauler Bridge": "AdvancedShipBridge",
  "Freighter Bridge": "T4ShipBridge",
  "Starlifter Structural Elements": "T4ShipElements",
  "Construction Kit": "BasicConstructionKit",
  "Consumer Electronics": "Electronics",
  "Truss": "ReinforcedTruss",
  "Rations": "BasicRations",
  "Fine Rations": "FineRations",
  "Tools": "BasicTools",
  "Exosuit": "BasicExosuit",
  "Nanites": "Nanobots",
  "Pump": "BasicPump",
  "Lab Suit": "LaboratorySuit",
  "Laboratory Suit": "LaboratorySuit",
  "Lab. Suit": "LaboratorySuit",
  "Assembly Plant": "BasicAssemblyPlant",
  "Chemical Plant": "ChemistryPlant",
  "Micronics Factory": "MicroelectronicsFactory",
  "Quantum Nexus": "QuantumComputingCenter",
};

function sanitize(value: string) {
  return value.replace(/[^a-z0-9]/gi, "");
}

export function resolveMaterialSpriteId({
  name,
  shortName,
  explicitId,
}: {
  name?: string | null;
  shortName?: string | null;
  explicitId?: string | null;
}) {
  const candidates = [
    explicitId,
    name ? MATERIAL_ICON_OVERRIDES[name] : undefined,
    shortName ? MATERIAL_ICON_OVERRIDES[shortName] : undefined,
    name ? sanitize(name) : undefined,
    shortName ? sanitize(shortName) : undefined,
  ].filter((value): value is string => Boolean(value));

  return candidates[0] ?? null;
}
