function safeTagValue(tags, keys) {
  for (const key of keys) {
    const value = tags?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

function categoryOf(item) {
  return String(item?.context?.category || item?.context?.label || '').toLowerCase();
}

function hasFlag(flags, ...terms) {
  return flags.some(flag => terms.some(term => `${flag.key} ${flag.label}`.toLowerCase().includes(term)));
}

function featureEvidence(features, matcher, limit = 5) {
  return features.filter(item => matcher(item)).slice(0, limit).map(item => ({
    name: item.name && !/^Unnamed mapped feature$/i.test(item.name) ? item.name : item.context?.label || 'Mapped feature',
    category: item.context?.label || item.context?.category || 'Mapped feature',
    distanceM: Number.isFinite(item.distanceM) ? item.distanceM : null,
    tags: item.tags || {},
  }));
}

/**
 * Builds traceable catchment context and source-investigation leads.
 * It does not infer a confirmed polluter or calculate a population count from OSM buildings.
 */
export function analyseEnvironmentalContext({ assessment, locationResult, waterBody } = {}) {
  const features = locationResult?.contextFeatures || [];
  const flags = assessment?.flags || [];
  const industrial = featureEvidence(features, item => categoryOf(item).includes('industrial') || item.tags?.industrial || item.tags?.landuse === 'industrial');
  const wastewater = featureEvidence(features, item => /wastewater|waste water|sewer|treatment|waste disposal/i.test(`${item.context?.label || ''} ${item.tags?.man_made || ''} ${item.tags?.amenity || ''} ${item.tags?.waterway || ''}`));
  const drainage = featureEvidence(features, item => categoryOf(item).includes('drainage') || /drain|ditch|sewer|culvert/i.test(String(item.tags?.waterway || '')));
  const agriculture = featureEvidence(features, item => categoryOf(item).includes('agriculture') || /farmland|farmyard|orchard|plant_nursery/i.test(String(item.tags?.landuse || '')));
  const buildings = featureEvidence(features, item => categoryOf(item).includes('building') || Boolean(item.tags?.building));
  const residential = featureEvidence(features, item => item.tags?.landuse === 'residential' || item.tags?.building === 'residential');
  const roads = featureEvidence(features, item => Boolean(item.tags?.highway) || categoryOf(item).includes('road') || Boolean(item.tags?.railway) || Boolean(item.tags?.bridge));
  const utilities = featureEvidence(features, item => /utility|water-infrastructure|facility/i.test(categoryOf(item)) || Boolean(item.tags?.man_made));
  const mappedLandUse = featureEvidence(features, item => Boolean(item.tags?.landuse) || Boolean(item.tags?.natural));
  const populationTagged = features.map(item => Number.parseFloat(String(item.tags?.population ?? '').replace(/,/g, ''))).filter(value => Number.isFinite(value) && value >= 0);
  const populationTotal = populationTagged.length ? populationTagged.reduce((sum, value) => sum + value, 0) : null;
  const elevationValues = features.map(item => safeTagValue(item.tags, ['ele', 'elevation'])).map(value => Number.parseFloat(value)).filter(Number.isFinite);
  const waterElevation = Number.parseFloat(safeTagValue(waterBody?.tags, ['ele', 'elevation']));
  if (Number.isFinite(waterElevation)) elevationValues.push(waterElevation);
  const elevation = elevationValues.length ? {
    min: Math.min(...elevationValues), max: Math.max(...elevationValues), count: elevationValues.length,
    note: 'Elevation values are taken only from explicit map tags. This is not a terrain model or a reliable slope/flow-direction calculation.',
  } : null;

  const contextFactors = [
    { key: 'topography', label: 'Topography / elevation', value: elevation ? `${elevation.min.toFixed(1)}–${elevation.max.toFixed(1)} m in ${elevation.count} tagged object(s)` : 'Not available in this map result', detail: elevation?.note || 'No elevation model or enough elevation tags were returned. Slope, catchment flow paths and upstream/downstream relationships cannot be inferred from this lookup.' },
    { key: 'population', label: 'Population / settlement context', value: populationTotal !== null ? `${populationTotal.toLocaleString()} in ${populationTagged.length} explicit population tag(s)` : `${buildings.length} mapped building(s); ${residential.length} residential feature(s)`, detail: populationTotal !== null ? 'Only explicit population tags in the returned map features were summed. Coverage, reference date and geographic scope may vary; this is not a live census or sewer-load measurement.' : 'No explicit population count was returned. Building and residential map features are only a settlement-density proxy, not a population estimate, occupancy count, sewer connection record or proof of wastewater release.' },
    { key: 'industry', label: 'Industrial context', value: `${industrial.length} mapped industrial feature(s)`, detail: industrial.length ? 'Mapped industrial features are investigation leads only. Check site activity, permits, discharge records, drainage connections and paired water samples.' : 'No industrial tags were returned. Incomplete mapping is possible; this does not prove there is no industry nearby.' },
    { key: 'wastewater', label: 'Wastewater / drainage context', value: `${wastewater.length} wastewater-related; ${drainage.length} drain / sewer / ditch feature(s)`, detail: 'Map tags do not show what a drain carries or where it discharges. A field inspection and verified network/outfall information are needed.' },
    { key: 'agriculture', label: 'Agricultural context', value: `${agriculture.length} mapped agricultural feature(s)`, detail: 'Agricultural tags can guide runoff investigations. Rainfall, field practices, slope and connected drainage need separate evidence.' },
    { key: 'roads', label: 'Transport / road runoff context', value: `${roads.length} mapped road, rail or bridge feature(s)`, detail: 'Roads and transport corridors can be relevant to stormwater, sediment, fuel or maintenance-runoff investigations. Their presence does not show that runoff reaches this waterbody.' },
    { key: 'utilities', label: 'Utilities / built infrastructure', value: `${utilities.length} mapped utility or man-made feature(s)`, detail: 'Mapped structures can help plan field inspections. Tags do not establish contents, condition, operation or hydraulic connectivity.' },
    { key: 'landuse', label: 'Mapped land use / natural cover', value: `${mappedLandUse.length} mapped land-use or natural feature(s)`, detail: 'Land-use classes provide broad spatial context only. They are not a direct measurement of pollutant loading or actual on-site activity.' },
    { key: 'geology', label: 'Geology / groundwater context', value: 'Not connected', detail: 'No geological map, soil chemistry, borehole record or groundwater interaction dataset is linked to this assessment yet.' },
    { key: 'hydrology', label: 'Hydrology / flow paths', value: 'Not modelled', detail: 'No digital elevation model, drainage-network validation, water-level history or flow-direction model is connected; upstream/downstream relationships remain unconfirmed.' },
    { key: 'weather', label: 'Rainfall / weather history', value: 'Not connected', detail: 'No rainfall event, flood history or weather time series is available to this assessment yet.' },
  ];

  const likelyCauses = [];
  const addCause = (key, title, explanation, evidence, checks) => {
    const uniqueEvidence = [...new Set(evidence.filter(Boolean))];
    likelyCauses.push({ key, title, explanation, evidence: uniqueEvidence, checks, confidence: uniqueEvidence.length ? 'Investigation lead · not confirmed' : 'Insufficient supporting evidence' });
  };

  if (hasFlag(flags, 'ecoli', 'ammonia', 'bod', 'cod', 'oxygen') && (wastewater.length || drainage.length || residential.length)) {
    addCause('wastewater', 'Possible wastewater or faecal input', 'Some measured indicators can be consistent with wastewater or faecal input. Nearby drains, wastewater-tagged facilities or built-up areas provide places to investigate, but proximity does not establish a connection or prove a release.', [
      flags.some(flag => /ecoli/i.test(flag.key)) ? 'E. coli result reported' : '',
      flags.some(flag => ['ammonia', 'bod', 'cod', 'oxygen'].some(term => flag.key.includes(term))) ? 'Organic-load / ammonia / dissolved-oxygen screening flag(s)' : '',
      wastewater.length ? `${wastewater.length} mapped wastewater-related feature(s)` : '',
      drainage.length ? `${drainage.length} mapped drainage feature(s)` : '',
      residential.length ? `${residential.length} residential map feature(s) (not a population count)` : '',
    ], ['Verify drain direction and outfall; obtain network drawings or operator records; collect paired upstream/downstream samples for BOD, COD, ammonia and microbiology.']);
  }
  if (hasFlag(flags, 'nitrate', 'phosphate', 'turbidity') && agriculture.length) {
    addCause('agricultural-runoff', 'Possible agricultural runoff / soil erosion', 'Nutrient or suspended-particle results can be consistent with runoff, and mapped agricultural land is a relevant investigation area. Rainfall, slope, farm practice and a connected flow path have not been verified.', [
      flags.some(flag => ['nitrate', 'phosphate'].includes(flag.key)) ? 'Nutrient screening flag(s)' : '',
      flags.some(flag => flag.key === 'turbidity') ? 'Turbidity screening flag' : '',
      `${agriculture.length} mapped agricultural feature(s)`,
    ], ['Check recent rainfall and field conditions; inspect drains and flow paths; compare upstream/downstream nutrient and suspended-solids samples.']);
  }
  if (hasFlag(flags, 'lead', 'mercury', 'cadmium', 'arsenic', 'cod', 'conductivity', 'tds') && industrial.length) {
    addCause('industrial-source', 'Possible industrial or commercial discharge', 'Some chemical or dissolved-load patterns can warrant an industrial-source investigation. Mapped industrial land/facilities are location context only and do not show that a facility discharged anything.', [
      flags.filter(flag => ['lead', 'mercury', 'cadmium', 'arsenic', 'cod', 'conductivity', 'tds'].includes(flag.key)).map(flag => `${flag.label} screening flag`)[0] || '',
      `${industrial.length} mapped industrial feature(s)`,
    ], ['Identify the actual facility and activity; review lawful permits and discharge records; inspect confirmed outfalls; use targeted laboratory analysis for suspected substances.']);
  }
  if (hasFlag(flags, 'turbidity', 'tds', 'conductivity') && !likelyCauses.length) {
    addCause('natural-geology-or-sediment', 'Possible natural mineral or sediment contribution', 'The selected readings can also arise from natural geology, sediment disturbance, seasonal conditions or flow changes. The current map result does not contain enough terrain or geology data to distinguish these possibilities.', ['Turbidity / dissolved-solids / conductivity screening flag(s)'], ['Compare with a local upstream/background site; inspect bank erosion and bed disturbance; obtain ion and suspended-solids tests.']);
  }

  if (!likelyCauses.length) {
    if (flags.length) {
      addCause('unresolved', 'Source not identified from current evidence', 'The available measurements contain screening flags, but the mapped context does not support a specific source hypothesis. Several natural, operational, sampling or pollution explanations remain possible.', flags.map(flag => `${flag.label} screening flag`), ['Collect confirmatory samples; inspect the site; add terrain, rainfall, discharge and upstream/downstream information before ranking sources.']);
    } else {
      likelyCauses.push({ key: 'none', title: 'No contamination source identified', explanation: assessment?.measuredCount ? 'No configured screening trigger was crossed in the measurements assessed. This does not clear the water or rule out unmeasured contaminants.' : 'There are not enough water-quality measurements to investigate a contamination source. Map context alone cannot determine water quality.', evidence: [], checks: ['Add current sensor measurements or laboratory results, then review the catchment context again.'], confidence: 'Not established' });
    }
  }

  return {
    contextFactors,
    likelyCauses,
    counts: { industrial: industrial.length, wastewater: wastewater.length, drainage: drainage.length, agriculture: agriculture.length, buildings: buildings.length, residential: residential.length, roads: roads.length, utilities: utilities.length, mappedLandUse: mappedLandUse.length },
    dataGaps: [
      !locationResult ? 'No GPS/map lookup is active: topography, population and surrounding land-use context have not been loaded.' : (!elevation ? 'No digital elevation model or usable elevation tags: topographic flow-path analysis is unavailable.' : 'No terrain-derived slope/catchment flow model: elevation tags alone cannot establish flow paths.'),
      'Population figures, sewer connectivity, permitted discharges, rainfall history, geology/soil chemistry and groundwater interaction are incomplete or unavailable unless provided separately.',
      ...(locationResult?.contextLookupWarning ? [`The map service reported incomplete surrounding-feature retrieval: ${locationResult.contextLookupWarning}`] : []),
      'Mapped nearby features are not proof of a pollution source or a physical connection to the selected waterbody.',
    ],
  };
}

export function buildRemedyPlan(assessment) {
  const flags = assessment?.flags || [];
  const remedies = [];
  const add = (key, title, why, actions, caution = '') => remedies.push({ key, title, why, actions, caution });
  if (!flags.length) {
    add('preventive', 'Preventive protection and routine monitoring', 'No configured screening trigger was crossed, or data are insufficient; this is not a declaration of safe water.', [
      'Continue scheduled field inspections and sampling at representative points.',
      'Protect the shoreline and catchment from new waste, runoff and unauthorized discharge.',
      'Verify water quality against standards applicable to the intended use before reuse or supply.',
    ], 'Do not treat water solely because the screening panel has no alert, and do not declare it safe without suitable verification.');
  }
  if (flags.some(flag => flag.key === 'turbidity' || flag.key === 'tss')) add('particles', 'Suspended particles / turbidity', 'Elevated particles can arise from sediment, runoff or solids-bearing discharge.', ['Identify and stop the verified source of sediment or solids where possible.', 'Consider settling, clarification and appropriately designed filtration for the confirmed particle type.', 'Manage collected sludge/residuals under an approved waste process.'], 'Disinfection or filtration alone may not address dissolved chemicals or all microbial risks.');
  if (flags.some(flag => flag.key === 'ph')) add('ph', 'pH imbalance', 'Acidic or alkaline water can affect treatment performance and material corrosion.', ['Repeat measurements with a calibrated meter and confirm alkalinity/acidity through a laboratory.', 'Have a qualified treatment professional design controlled pH adjustment for the actual water chemistry.', 'Re-test pH and relevant dissolved constituents after treatment.'], 'Do not add chemicals directly to a natural waterbody based on one reading.');
  if (flags.some(flag => ['oxygen', 'bod', 'cod', 'ammonia'].includes(flag.key))) add('organic-load', 'Organic loading / low oxygen indicators', 'Low dissolved oxygen or elevated organic-load indicators may point to a source-control and treatment issue.', ['Find and control confirmed sewage or organic discharge pathways.', 'Use appropriate wastewater treatment and process control at the source.', 'Monitor dissolved oxygen, BOD, COD, ammonia and microbial indicators after corrective action.'], 'Aeration may be an interim ecological measure in a professionally designed response; it does not remove the source or all contaminants.');
  if (flags.some(flag => ['nitrate', 'phosphate'].includes(flag.key))) add('nutrients', 'Nutrient reduction', 'Nutrient enrichment can contribute to eutrophication depending on concentration, forms and waterbody conditions.', ['Reduce verified fertilizer, manure, detergent or wastewater inputs at source.', 'Use suitable buffer strips, erosion control and runoff management where relevant.', 'Select biological or chemical nutrient treatment only after jar tests and professional design.'], 'Confirm whether laboratory results are reported as nutrient ion or as nitrogen/phosphorus before comparing limits.');
  if (flags.some(flag => ['tds', 'conductivity'].includes(flag.key))) add('dissolved-salts', 'Dissolved salts / conductivity', 'High dissolved-solids or conductivity readings do not identify the ions responsible.', ['Obtain major-ion analysis and identify the dissolved constituents first.', 'Evaluate ion exchange, membrane treatment or another process only for the identified constituents.', 'Plan concentrate/brine and residual disposal before selecting a process.'], 'Do not assume reverse osmosis is appropriate for every high-TDS water source.');
  if (flags.some(flag => ['lead', 'mercury', 'cadmium', 'arsenic'].includes(flag.key))) add('metals', 'Heavy-metal investigation and treatment', 'A metal result needs confirmation using the stated method, sample traceability and correct units.', ['Confirm results with an accredited laboratory and identify the metal species and concentration.', 'Use contaminant-specific adsorption, precipitation, ion exchange or membrane treatment only after treatability testing.', 'Manage metal-bearing sludge and spent media as controlled residuals.'], 'Do not use treated water until independent testing demonstrates it meets the applicable standard for the intended use.');
  if (flags.some(flag => flag.key.includes('ecoli') || flag.key.includes('coliform'))) add('microbial', 'Microbiological protection', 'A detected faecal indicator requires a prompt, use-specific response and confirmation.', ['Prevent use for drinking or food preparation until public-health authorities or qualified professionals advise it is suitable.', 'Investigate sewage, animal-waste and surface-runoff pathways.', 'Apply a validated treatment and disinfection barrier designed for the water and then verify with follow-up microbiology.'], 'Boiling or household disinfection advice depends on the contaminant and official local instructions; this panel is not an emergency public-health notice.');
  if (flags.some(flag => ['chloride', 'sulfate', 'fluoride', 'iron', 'manganese'].includes(flag.key))) add('ions-metals', 'Specific dissolved ions / metals', 'These measurements need comparison with standards for the intended use and appropriate lab methods.', ['Confirm analytical method, units, detection limits and the relevant local standard.', 'Choose a contaminant-specific treatment only after water-chemistry and treatability review.', 'Verify treatment residuals and final water quality independently.']);
  return remedies;
}
