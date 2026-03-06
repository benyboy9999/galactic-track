const ICON_OVERRIDES = {
  // Plural → singular
  'Cows':                                 'Cow',
  'Chickens':                             'Chicken',
  // Bare material names that have tier prefixes in sprites
  'Iron':                                 'IronBar',
  'Copper':                               'CopperBar',
  'Rations':                              'BasicRations',
  'Fine Rations':                         'FineRations',
  'Exosuit':                              'BasicExosuit',
  'Tools':                                'BasicTools',
  'Advanced Tools':                       'AdvancedTools',
  'Adv. Tools':                           'AdvancedTools',
  'Construction Kit':                     'BasicConstructionKit',
  'Prefab Kit':                           'BasicPrefabKit',
  'Modern Prefab Kit':                    'ModernPrefabKit',
  'Advanced Prefab Kit':                  'AdvancedPrefabKit',
  'Amenities':                            'BasicAmenities',
  'Advanced Amenities':                   'AdvancedAmenities',
  'Hull Plate':                           'BasicHullPlate',
  'Pump':                                 'BasicPump',
  'Assembly Plant':                       'BasicAssemblyPlant',
  'Truss':                                'ReinforcedTruss',
  'Linear FTL Emitter':                   'BasicFTLEmitter',
  // Spelling / abbreviation differences
  'Copper Wire':                          'CopperWiring',
  'Consumer Electronics':                 'Electronics',
  'Electric Motor':                       'Motor',
  'Artificial Intelligence':              'AI',
  'AI':                                   'AI',
  'Advanced Processing Unit':             'APU',
  'APU':                                  'APU',
  'Nanites':                              'Nanobots',
  'Bio-Nutrient Blend':                   'NutrientBlend',
  'Nutrient Blend':                       'NutrientBlend',
  'Hydrogen Fuel':                        'HydrogenFuelCell',
  'Superconducting Coil':                 'HyperCoil',
  'SuperCoil':                            'HyperCoil',
  'Field Cooling System':                 'FieldCooling',
  'Field Cooling':                        'FieldCooling',
  'Titanium Carbide Drill':               'AdvancedDrill',
  'TiC Drill':                            'AdvancedDrill',
  'Molecular Fusion Kit':                 'WeldingKit2',
  'Ethanol':                              'Gasoline',
  'Graphenium Wire':                      'Superconductors',
  'Starglass Hull Plate':                 'QuadraniumHullPlate',
  'Ship Repair Kit':                      'ShipRepairKit',
  'Lab Suit':                             'LaboratorySuit',
  'Laboratory Suit':                      'LaboratorySuit',
  'Lab. Suit':                            'LaboratorySuit',
  'Chemical Plant':                       'ChemistryPlant',
  'Micronics Factory':                    'MicroelectronicsFactory',
  'Quantum Nexus':                        'QuantumComputingCenter',
  // Research tiers
  'Research':                             'ResearchData',
  'Research Data':                        'ResearchData',
  'Advanced Research':                    'AdvancedResearchData',
  'Advanced Research Data':               'AdvancedResearchData',
  'Adv. Research Data':                   'AdvancedResearchData',
  'Apex Research':                        'ApexResearchData',
  'Apex Research Data':                   'ApexResearchData',
  'Quantum Research':                     'QuantumResearchData',
  'Quantum Research Data':                'QuantumResearchData',
  // FTL tiers
  'Quantum FTL Emitter':                  'AdvancedFTLEmitter',
  'Extra-dimensional FTL Emitter':        'SuperiorFTLEmitter',
  // Ship bridges
  'Shuttle Bridge':                       'BasicShipBridge',
  'Hauler Bridge':                        'AdvancedShipBridge',
  'Freighter Bridge':                     'T4ShipBridge',
  // Ship elements
  'Starlifter Structural Elements':       'T4ShipElements',
  // Shipment packs
  'Medicine Shipment':                    'Pack_Medicine',
  'Food Shipment':                        'Pack_Food',
  'Ship Parts Shipment':                  'Pack_ShipParts',
  'Defense systems pack':                 'Pack_Defense',
  'Habitats Shipment':                    'Pack_Habitats',
  'Scientific Instruments Shipment':      'Pack_Scientific',
  'Gifts':                                'Pack_Gifts',
};

// "Basic Construction Kit" → "BasicConstructionKit"
export function toIconId(name) {
  if (!name) return '';
  if (ICON_OVERRIDES[name]) return ICON_OVERRIDES[name];
  return name.replace(/[^a-zA-Z0-9 ]/g, '').split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}
