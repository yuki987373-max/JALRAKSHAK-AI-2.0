/*
 * JalRakshak v0.2 explainable screening engine.
 * These are illustrative prototype triggers, not regulatory standards or a trained AI model.
 */
const SCREENING_BANDS = {
  phMin: 6.5,
  phMax: 8.5,
  turbidityMax: 5,
  dissolvedOxygenMin: 5,
  tdsMax: 500,
};

function numericValue(value) {
  const parsed = Number.parseFloat(String(value ?? '').replaceAll(',', '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function getMetric(metrics, pattern) {
  // Prefer a manually edited/direct metric when it exists, else take the first matching measurement.
  const candidates = metrics.filter(([label]) => pattern.test(String(label).toLowerCase()));
  if (!candidates.length) return null;
  const chosen = candidates.find(([label]) => /manual sample/i.test(label)) || candidates[0];
  const value = numericValue(chosen[1]);
  return value === null ? null : { label: chosen[0], value, unit: chosen[2] || '' };
}

function sampleTone(key, value) {
  if (key === 'pH') return value < SCREENING_BANDS.phMin || value > SCREENING_BANDS.phMax ? 'danger' : 'good';
  if (key === 'turbidity') return value > 25 ? 'danger' : value > SCREENING_BANDS.turbidityMax ? 'warning' : 'good';
  if (key === 'dissolvedOxygen') return value < 3 ? 'danger' : value < SCREENING_BANDS.dissolvedOxygenMin ? 'warning' : 'good';
  if (key === 'tds') return value > SCREENING_BANDS.tdsMax ? 'warning' : 'good';
  return 'normal';
}

export function applySampleValues(metrics, values) {
  const next = metrics.map(metric => [...metric]);
  const specs = [
    ['pH', 'pH', '', /\bph\b/i],
    ['turbidity', 'Turbidity', 'NTU', /turbidity/i],
    ['dissolvedOxygen', 'Dissolved oxygen', 'mg/L', /dissolved oxygen/i],
    ['tds', 'TDS', 'mg/L', /\btds\b/i],
  ];

  for (const [key, newLabel, unit, matcher] of specs) {
    if (!(key in values)) continue;
    const value = Number(values[key]);
    if (!Number.isFinite(value) || value < 0 || (key === 'pH' && value > 14)) continue;
    const manualLabel = `Manual sample · ${newLabel}`;
    const manualExisting = next.find(([label]) => String(label).toLowerCase() === manualLabel.toLowerCase());
    const matching = next.filter(([label]) => matcher.test(String(label).toLowerCase()));
    const exact = next.find(([label]) => String(label).toLowerCase() === newLabel.toLowerCase());
    const target = manualExisting || (matching.length > 1 ? null : (exact || matching[0]));
    if (target) {
      const index = next.indexOf(target);
      next[index] = [target[0], String(value), unit || target[2] || '', sampleTone(key, value)];
    } else {
      next.push([manualLabel, String(value), unit, sampleTone(key, value)]);
    }
  }
  return next;
}

export function analyseWaterQuality(site, { profile = 'surface' } = {}) {
  const metrics = site.metrics || [];
  const drinkingProfile = profile === 'bis10500';
  const ph = getMetric(metrics, /\bph\b/i);
  const turbidity = getMetric(metrics, /turbidity/i);
  const oxygen = getMetric(metrics, /dissolved oxygen/i);
  const tds = getMetric(metrics, /\btds\b/i);
  const conductivity = getMetric(metrics, /conductivity/i);
  const nitrate = getMetric(metrics, /nitrate/i);
  const phosphate = getMetric(metrics, /phosphate/i);
  const ammonia = getMetric(metrics, /ammonia/i);
  const bod = getMetric(metrics, /\bbod\b|biochemical oxygen demand/i);
  const cod = getMetric(metrics, /\bcod\b|chemical oxygen demand/i);
  const ecoliAnyProfile = getMetric(metrics, /e\.? ?coli|ecoli/i);
  const flags = [];
  const hypotheses = [];
  const nextSteps = [];
  const drinkingAnalytes = drinkingProfile ? {
    lead: getMetric(metrics, /\blead\b/i),
    mercury: getMetric(metrics, /\bmercury\b/i),
    cadmium: getMetric(metrics, /\bcadmium\b/i),
    arsenic: getMetric(metrics, /\barsenic\b/i),
    ecoli: getMetric(metrics, /e\.? ?coli|ecoli/i),
  } : {};
  // Track every recognized measurement in the UI, even when this prototype does
  // not have a validated decision threshold for that analyte. Only the explicit
  // checks below can create screening flags.
  const additionalMeasurements = [
    getMetric(metrics, /temperature/i), getMetric(metrics, /water level|depth/i),
    getMetric(metrics, /salinity/i), getMetric(metrics, /hardness/i), getMetric(metrics, /alkalinity/i),
    conductivity, nitrate, phosphate, ammonia, bod, cod,
    getMetric(metrics, /lead/i), getMetric(metrics, /mercury/i), getMetric(metrics, /cadmium/i), getMetric(metrics, /arsenic/i),
    getMetric(metrics, /iron/i), getMetric(metrics, /manganese/i), getMetric(metrics, /chloride/i),
    getMetric(metrics, /sulphate|sulfate/i), getMetric(metrics, /fluoride/i), getMetric(metrics, /free residual chlorine|free chlorine/i),
    getMetric(metrics, /total suspended solids|\btss\b/i), getMetric(metrics, /apparent colour|colour|color/i),
    getMetric(metrics, /orp|redox/i), ecoliAnyProfile, getMetric(metrics, /total coliform|coliform/i),
  ].filter(Boolean);
  const coreMeasurements = [ph, turbidity, ...(drinkingProfile ? [] : [oxygen, ecoliAnyProfile]), tds, conductivity, nitrate, phosphate, ammonia, bod, cod, ...Object.values(drinkingAnalytes)].filter(Boolean);
  const measuredCount = new Set([...coreMeasurements, ...additionalMeasurements].map(item => item.label)).size;
  const screenedCount = new Set(coreMeasurements.map(item => item.label)).size;
  const screenedLabels = new Set(coreMeasurements.map(item => item.label));
  const unscoredMeasurements = additionalMeasurements
    .filter(item => !screenedLabels.has(item.label))
    .filter((item, index, all) => all.findIndex(other => other.label === item.label) === index)
    .map(item => ({ label: item.label, value: item.value, unit: item.unit }));

  if (ph && (ph.value < SCREENING_BANDS.phMin || ph.value > SCREENING_BANDS.phMax)) {
    flags.push({ key: 'ph', label: 'pH', value: ph.value, unit: '', tone: 'danger', message: `Outside the illustrative ${SCREENING_BANDS.phMin.toFixed(1)}–${SCREENING_BANDS.phMax.toFixed(1)} screening band; check probe calibration and confirm with a second measurement.` });
    hypotheses.push('An acidic or alkaline input, or natural geochemical conditions, may explain the pH result. pH alone cannot identify the source.');
    nextSteps.push('Repeat pH using a calibrated meter and collect a confirmatory sample before selecting a treatment.');
  }
  const turbidityTrigger = drinkingProfile ? 1 : SCREENING_BANDS.turbidityMax;
  if (turbidity && turbidity.value > turbidityTrigger) {
    const turbidityDanger = drinkingProfile ? turbidity.value > 5 : turbidity.value > 25;
    flags.push({ key: 'turbidity', label: 'Turbidity', value: turbidity.value, unit: turbidity.unit || 'NTU', tone: turbidityDanger ? 'danger' : 'warning', message: drinkingProfile ? `Above the BIS IS 10500:2012 acceptable limit of 1 NTU${turbidity.value > 5 ? ' and above its 5 NTU permissible limit' : '; the standard lists 5 NTU as the permissible limit only in the absence of an alternate source'}. Confirm with an appropriate laboratory method.` : `Above the illustrative ${SCREENING_BANDS.turbidityMax} NTU screening trigger; particle levels and treatment needs require confirmation.` });
    hypotheses.push('Elevated suspended particles may come from sediment/runoff, disturbed bottom material, sewage, or solids-bearing discharge; compare upstream and downstream samples.');
    nextSteps.push('Inspect for runoff or discharge pathways and compare turbidity upstream/downstream; use appropriate treatment design rather than assuming filtration alone is sufficient.');
  }
  if (!drinkingProfile && oxygen && oxygen.value < SCREENING_BANDS.dissolvedOxygenMin) {
    flags.push({ key: 'oxygen', label: 'Dissolved oxygen', value: oxygen.value, unit: oxygen.unit || 'mg/L', tone: oxygen.value < 3 ? 'danger' : 'warning', message: `Below the illustrative ${SCREENING_BANDS.dissolvedOxygenMin} mg/L screening trigger; interpretation depends on local ecology, temperature, and intended use.` });
    hypotheses.push('Low dissolved oxygen can be associated with organic loading, stagnant flow, warm conditions, or algal decay. It does not confirm a toxin or a particular polluter.');
    nextSteps.push('Where relevant, test BOD/COD, ammonia, nutrients, and microbial indicators through an accredited laboratory.');
  }
  if (tds && tds.value > SCREENING_BANDS.tdsMax) {
    flags.push({ key: 'tds', label: 'TDS', value: tds.value, unit: tds.unit || 'mg/L', tone: drinkingProfile && tds.value > 2000 ? 'danger' : 'warning', message: drinkingProfile ? `Above the BIS IS 10500:2012 acceptable limit of 500 mg/L${tds.value > 2000 ? ' and above its 2,000 mg/L permissible limit in the absence of an alternate source' : '; the standard lists 2,000 mg/L as the permissible limit in the absence of an alternate source'}. TDS does not identify which dissolved substances are present.` : `Above the illustrative ${SCREENING_BANDS.tdsMax} mg/L review trigger; TDS does not identify which dissolved substances are present.` });
    hypotheses.push('Elevated dissolved solids may reflect natural minerals, salinity, or a dissolved discharge. Verify with conductivity and ion-specific laboratory tests.');
    nextSteps.push('Check conductivity and order contaminant-specific laboratory tests before choosing desalination, ion exchange, or another treatment.');
  }

  // Additional prototype review triggers. These are investigation prompts, not
  // universal environmental limits or regulatory classifications.
  if (conductivity && conductivity.value > 1500) {
    flags.push({ key: 'conductivity', label: 'Electrical conductivity', value: conductivity.value, unit: conductivity.unit || 'µS/cm', tone: 'warning', message: 'Above the prototype review trigger of 1,500 µS/cm. Natural geology, salinity, season and catchment background can produce elevated conductivity; compare with a local baseline and ion-specific laboratory results.' });
    hypotheses.push('Elevated conductivity may reflect dissolved salts, natural mineral geology, saline intrusion, or a discharge. The measurement cannot identify which ions or source are responsible.');
    nextSteps.push('Compare conductivity with upstream/background stations and request major-ion analysis (for example chloride, sulphate and alkalinity) before selecting treatment.');
  }
  if (nitrate && nitrate.value > 10) {
    flags.push({ key: 'nitrate', label: 'Nitrate', value: nitrate.value, unit: nitrate.unit || 'mg/L', tone: 'warning', message: 'Above the prototype review trigger of 10 mg/L. Confirm whether the laboratory reports nitrate as NO₃⁻ or as nitrogen (NO₃-N); the two reporting bases are not interchangeable.' });
    hypotheses.push('Elevated nitrate can be associated with fertilizer runoff, sewage, animal waste, or natural sources. Nearby farmland or settlements are investigation context, not proof of a connection.');
    nextSteps.push('Confirm the nitrate reporting basis and collect upstream/downstream samples; inspect agricultural and wastewater pathways after checking drainage direction.');
  }
  if (phosphate && phosphate.value > 0.1) {
    flags.push({ key: 'phosphate', label: 'Phosphate', value: phosphate.value, unit: phosphate.unit || 'mg/L', tone: 'warning', message: 'Above the prototype nutrient-review trigger of 0.1 mg/L. Nutrient interpretation depends on whether the result is reported as PO₄ or phosphorus (P), the waterbody type and season.' });
    hypotheses.push('Elevated phosphate may be linked to fertilizer runoff, soil erosion, detergents or wastewater. The specific source requires field and laboratory confirmation.');
    nextSteps.push('Confirm the phosphate reporting basis and inspect stormwater, farm runoff and wastewater pathways.');
  }
  if (ammonia && ammonia.value > 1) {
    flags.push({ key: 'ammonia', label: 'Ammonia', value: ammonia.value, unit: ammonia.unit || 'mg/L', tone: 'warning', message: 'Above the prototype review trigger of 1 mg/L. Ammonia toxicity depends strongly on pH, temperature and whether the result is reported as NH₃ or as nitrogen.' });
    hypotheses.push('Ammonia can be associated with sewage, animal waste, fertilizer or organic-matter breakdown; pH and temperature are needed for further interpretation.');
    nextSteps.push('Confirm the ammonia reporting basis, measure pH and temperature at the same time, and order a confirmatory laboratory test.');
  }
  if (bod && bod.value > 5) {
    flags.push({ key: 'bod', label: 'BOD', value: bod.value, unit: bod.unit || 'mg/L', tone: 'warning', message: 'Above the prototype organic-loading review trigger of 5 mg/L. Method, incubation period and local waterbody classification matter.' });
    hypotheses.push('Higher BOD may indicate biodegradable organic matter from sewage, food-processing or other organic discharges, but it does not identify a polluter.');
    nextSteps.push('Review the BOD test method and pair it with COD, dissolved oxygen, ammonia and microbiological testing.');
  }
  if (cod && cod.value > 20) {
    flags.push({ key: 'cod', label: 'COD', value: cod.value, unit: cod.unit || 'mg/L', tone: 'warning', message: 'Above the prototype organic/oxidizable-load review trigger of 20 mg/L. COD is non-specific and is not a direct identification of a toxic chemical.' });
    hypotheses.push('Higher COD may reflect organic or chemically oxidizable material from multiple possible sources. Identify specific compounds with targeted laboratory analysis.');
    nextSteps.push('Request a suitable targeted laboratory panel and compare COD/BOD patterns with upstream and downstream samples.');
  }
  if (!drinkingProfile && ecoliAnyProfile && ecoliAnyProfile.value > 0) {
    flags.push({ key: 'ecoli-surface', label: 'E. coli indicator', value: ecoliAnyProfile.value, unit: ecoliAnyProfile.unit || 'CFU/100 mL', tone: 'danger', message: 'E. coli has been reported in the sample. The health meaning depends on the intended use and applicable local criteria; confirm the method and sample volume with the laboratory.' });
    hypotheses.push('E. coli can indicate faecal contamination, which may be associated with sewage, animal waste or runoff. It does not identify which source is responsible.');
    nextSteps.push('Arrange confirmatory microbiological testing and follow local public-health advice for the intended water use.');
  }


  if (drinkingProfile) {
    const compareMetal = (key, label, acceptableUgL, permissibleUgL = acceptableUgL) => {
      const metric = drinkingAnalytes[key];
      if (!metric) return;
      const unit = String(metric.unit || '').toLowerCase().replace(/\s/g, '');
      let valueUgL = null;
      if (unit.includes('µg') || unit.includes('ug')) valueUgL = metric.value;
      else if (unit === 'mg/l' || unit === 'mgl') valueUgL = metric.value * 1000;
      if (valueUgL === null) {
        nextSteps.push(`Confirm the unit for ${label} in the laboratory report before comparing it with the BIS reference.`);
        return;
      }
      if (valueUgL > acceptableUgL) {
        const abovePermissible = valueUgL > permissibleUgL;
        flags.push({ key, label, value: metric.value, unit: metric.unit || 'unit not stated', tone: abovePermissible || permissibleUgL === acceptableUgL ? 'danger' : 'warning', message: `Above the BIS IS 10500:2012 ${acceptableUgL} µg/L acceptable reference${permissibleUgL > acceptableUgL ? `; ${permissibleUgL} µg/L is the permissible limit in the absence of an alternate source` : ''}. Confirm sample identity, method, and result with the issuing laboratory.` });
        hypotheses.push(`${label} was reported above the selected drinking-water reference. This is a result-level concern; it does not identify the pollution source.`);
        nextSteps.push(`Ask the laboratory to confirm ${label} with the specified method and review source protection and treatment with a qualified water professional.`);
      }
    };
    compareMetal('lead', 'Lead', 10);
    compareMetal('mercury', 'Mercury', 1);
    compareMetal('cadmium', 'Cadmium', 3);
    compareMetal('arsenic', 'Arsenic', 10, 50);

    const ecoli = drinkingAnalytes.ecoli;
    if (ecoli) {
      const unit = String(ecoli.unit || '').toLowerCase().replace(/\s/g, '');
      if (unit.includes('cfu/100') || unit.includes('/100ml') || unit.includes('100ml')) {
        if (ecoli.value > 0) {
          flags.push({ key: 'ecoli', label: 'E. coli', value: ecoli.value, unit: ecoli.unit || 'CFU/100 mL', tone: 'danger', message: 'E. coli was detected in the uploaded result. BIS IS 10500:2012 states it shall not be detectable in a 100 mL sample of drinking water. Confirm promptly with the laboratory and follow local public-health advice.' });
          hypotheses.push('E. coli detection indicates faecal contamination may be present, but does not by itself identify the source or all pathogens that may be present.');
          nextSteps.push('Arrange confirmatory microbiological testing and protect the supply according to qualified public-health guidance.');
        }
      } else {
        nextSteps.push('Check the E. coli result unit and sample volume; the drinking-water comparison requires a result expressed for a 100 mL sample.');
      }
    }
    nextSteps.push('This BIS comparison is for drinking-water screening only. Do not apply it as a surface-water ecological classification or as a final safety certificate.');
  }

  if (flags.length) {
    hypotheses.push('A sensor, sampling, preservation, or transcription problem remains possible; check calibration, fouling, timestamps, units, chain of custody, and a duplicate sample.');
    nextSteps.push('Keep the event marked as suspected, protect potentially unaffected supplies from cross-connection, and ask a qualified operator to assess any isolation decision.');
  }

  const baseCauses = (site.causes || []).filter(cause => !/no specific cause indicated/i.test(cause));
  if (!flags.length && measuredCount > 0) {
    hypotheses.push(`No checked parameter crossed the configured screening triggers (${screenedCount} parameter(s) checked). Other reported values may be informative but do not yet have a validated rule in this prototype; unmeasured chemicals, microbes, and other hazards are not assessed.`);
    if (baseCauses.length) hypotheses.push(...baseCauses);
  } else if (measuredCount === 0) {
    hypotheses.push('There are not enough supported numeric measurements for the current screening rules to assess water quality at this selected object.');
    if (baseCauses.length) hypotheses.push(...baseCauses);
  }

  const priority = measuredCount === 0
    ? { label: 'INSUFFICIENT DATA · REVIEW', tone: 'warning' }
    : flags.length >= 3 || flags.some(f => f.tone === 'danger' && ['ph', 'oxygen', 'turbidity', 'ecoli-surface', 'ecoli'].includes(f.key))
      ? { label: 'HIGHER SCREENING PRIORITY · VERIFY', tone: 'danger' }
      : flags.length > 0
        ? { label: 'REVIEW NEEDED · VERIFY', tone: 'warning' }
        : { label: 'NO DEMO TRIGGER · NOT CLEARED', tone: 'good' };

  let summary;
  if (measuredCount === 0) {
    summary = 'The selected object does not have enough supported numeric readings for the current screening rules. Add a sample or connect validated data. Existing object notes are shown as context, not as a confirmed diagnosis.';
  } else if (flags.length) {
    summary = `The rule engine flagged ${flags.length} item(s) among ${screenedCount} parameter(s) with configured screening checks; ${measuredCount} recognized measurement(s) are available overall. The patterns are clues for follow-up—not a toxicity identification, source attribution, or safety verdict.`;
  } else {
    summary = `${screenedCount} parameter(s) with configured screening checks did not trigger these rules; ${measuredCount} recognized measurement(s) are available overall. Important contaminants may not be measured here, and some reported indicators have no configured threshold. Water is not declared safe.`;
  }

  const combinedNextSteps = [...nextSteps, ...(site.remedies || [])];
  return {
    measuredCount,
    screenedCount,
    unscoredMeasurements,
    flags,
    hypotheses: [...new Set(hypotheses)].slice(0, 5),
    nextSteps: [...new Set(combinedNextSteps)].slice(0, 6),
    summary,
    priorityLabel: priority.label,
    priorityTone: priority.tone,
    profile,
    thresholdSource: drinkingProfile ? 'BIS IS 10500:2012 drinking-water reference linked by CPCB; verify current adopted version and applicability' : 'illustrative surface-water prototype triggers',
  };
}
