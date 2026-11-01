export const siteData = {
  river: {
    id: 'river', name: 'River Reach A', type: 'Water body', status: 'Monitored', statusTone: 'good',
    location: 'Demo catchment · Reach A', coordinates: '25.612° N, 85.142° E (example only)',
    position: { x: -3.1, y: 0.35, z: 0.25 },
    description: 'A schematic river reach used to demonstrate how JalRakshak displays water quality in context.',
    metrics: [ ['Water level', '2.4', 'm', 'good'], ['pH', '7.2', '', 'good'], ['Turbidity', '4.8', 'NTU', 'good'], ['Dissolved oxygen', '7.1', 'mg/L', 'good'], ['Temperature', '22.4', '°C', 'normal'], ['TDS', '286', 'mg/L', 'normal'] ],
    analysis: 'The demonstration readings are within the example system’s monitoring bands. This is not a declaration that the water is safe to drink.',
    causes: ['No specific cause indicated by these simulated readings.'],
    remedies: ['Continue routine monitoring at upstream and downstream points.', 'Compare results with local standards and laboratory tests before approving any use.'],
    conservation: 'Keep clean-water and drainage pathways separate; report any unusual change in colour, odour, flow, or readings.'
  },
  hotspot: {
    id: 'hotspot', name: 'Possible contamination zone', type: 'Alert zone', status: 'High priority', statusTone: 'danger',
    location: 'Demo catchment · Downstream of outlet', coordinates: 'Illustrative coordinates only',
    position: { x: 1.8, y: 0.65, z: 1.1 },
    description: 'A simulated hotspot demonstrating how an alert can be selected and inspected in 3D.',
    metrics: [ ['Water level', '2.1', 'm', 'normal'], ['pH', '5.4', '', 'danger'], ['Turbidity', '38', 'NTU', 'danger'], ['Dissolved oxygen', '3.2', 'mg/L', 'danger'], ['Temperature', '26.8', '°C', 'normal'], ['TDS', '890', 'mg/L', 'warning'] ],
    analysis: 'Multiple simulated readings are abnormal. The pattern suggests a contamination event may be present, but these readings alone do not identify a specific toxin or confirm the source.',
    causes: ['Possible wastewater or industrial discharge (hypothesis)', 'Possible sediment or runoff event (hypothesis)', 'Sensor drift or calibration issue must also be ruled out'],
    remedies: ['Collect confirmatory samples and check sensor calibration.', 'Inspect upstream discharge points and compare upstream/downstream samples.', 'Have qualified operators assess temporary isolation options; do not reconnect until testing supports it.'],
    conservation: 'Protect unaffected supplies from cross-connection. Do not label nearby water as potable until appropriate testing and clearance.'
  },
  sensor: {
    id: 'sensor', name: 'Sensor Node 04', type: 'Monitoring station', status: 'Online · demo', statusTone: 'info',
    location: 'Demo catchment · River bank', coordinates: 'Illustrative coordinates only',
    position: { x: -0.9, y: 0.9, z: -2.7 },
    description: 'A multi-parameter monitoring station. Live hardware is not connected in this starter build.',
    metrics: [ ['pH', '5.4', '', 'danger'], ['Turbidity', '38', 'NTU', 'danger'], ['Temperature', '26.8', '°C', 'normal'], ['TDS', '890', 'mg/L', 'warning'], ['Battery', '92', '%', 'good'], ['Signal', 'Strong', '', 'good'] ],
    analysis: 'The sensor is shown as online in demo mode. In a real deployment, readings need timestamps, calibration metadata, health checks, and validation.',
    causes: ['Readings may reflect a water-quality change, a sensor fault, or both.', 'Cross-check with a second sensor or a laboratory sample before a consequential decision.'],
    remedies: ['Check calibration and inspect the probe for fouling.', 'Compare with nearby stations and recent baseline readings.', 'Log maintenance and preserve original readings for audit.'],
    conservation: 'Use sensor trends to prioritise inspections and reduce unnecessary sampling trips, while retaining required confirmatory testing.'
  },
  reservoir: {
    id: 'reservoir', name: 'North Reservoir', type: 'Reservoir', status: 'Protected · demo', statusTone: 'good',
    location: 'Demo catchment · North storage', coordinates: 'Illustrative coordinates only',
    position: { x: 5.3, y: 0.48, z: -2.7 },
    description: 'A model storage reservoir. Its illustrated capacity and readings are synthetic demonstration values.',
    metrics: [ ['Water level', '78', '%', 'good'], ['pH', '7.1', '', 'good'], ['Turbidity', '2.1', 'NTU', 'good'], ['Dissolved oxygen', '7.6', 'mg/L', 'good'], ['Temperature', '21.2', '°C', 'normal'], ['Estimated stored', '18,400', 'm³', 'normal'] ],
    analysis: 'The example readings are stable in this demonstration. Any real storage system requires monitoring suited to its intended use and treatment process.',
    causes: ['No active alert is configured for this simulated reservoir.'],
    remedies: ['Maintain protected intake zones and routine inspections.', 'Verify treatment barriers and sampling schedule.', 'Keep isolation controls tested and clearly labelled.'],
    conservation: 'Use level and inflow data to plan storage; only release water for a defined use after it meets the relevant quality requirements.'
  },
  source: {
    id: 'source', name: 'Industrial Site B', type: 'Potential source', status: 'Investigate', statusTone: 'warning',
    location: 'Demo catchment · East industrial area', coordinates: 'Illustrative coordinates only',
    position: { x: 2.7, y: 0.55, z: -3.15 },
    description: 'A schematic industrial site. Its proximity to a hotspot is a visual investigation cue, not proof that it caused pollution.',
    metrics: [ ['Nearby alert', '1', 'zone', 'warning'], ['Discharge record', 'Unavailable', '', 'warning'], ['Upstream sample', 'Missing', '', 'warning'], ['Downstream sample', 'Elevated', '', 'danger'], ['Source confidence', 'Unverified', '', 'warning'], ['Inspection', 'Required', '', 'info'] ],
    analysis: 'The site is a candidate for inspection only. Location and a nearby abnormal reading do not prove that this facility caused the event.',
    causes: ['Potential discharge pathway should be inspected.', 'Other sources, runoff, sewer connections, and sensor faults must also be considered.'],
    remedies: ['Review permits and discharge logs where lawfully available.', 'Inspect drainage and sample safely through qualified personnel.', 'Do not attribute responsibility without corroborating evidence.'],
    conservation: 'If an unauthorized discharge is verified, contain the source through approved procedures and protect unrelated clean-water supplies.'
  },
  plant: {
    id: 'plant', name: 'Water Treatment Plant', type: 'Treatment infrastructure', status: 'Operating · demo', statusTone: 'info',
    location: 'Demo catchment · East bank', coordinates: 'Illustrative coordinates only',
    position: { x: 6.0, y: 0.55, z: 2.7 },
    description: 'A schematic treatment facility for exploring source water, treatment stages, and verification points.',
    metrics: [ ['Influent turbidity', '38', 'NTU', 'warning'], ['Outlet turbidity', '1.2', 'NTU', 'good'], ['pH at outlet', '7.0', '', 'good'], ['Flow', '42', 'L/s', 'normal'], ['Treatment stage', 'Filtration', '', 'info'], ['Verification', 'Pending', '', 'warning'] ],
    analysis: 'The values are simulated. A lower turbidity result alone does not prove that all chemical or microbiological contaminants have been removed.',
    causes: ['Example influent quality is elevated; the upstream source is not confirmed.'],
    remedies: ['Check treatment performance against the contaminants of concern.', 'Verify outlet quality with suitable testing before distribution.', 'Manage sludge and treatment residuals according to approved procedures.'],
    conservation: 'Track process losses and reuse backwash water only when a site-specific assessment and treatment design permit it.'
  }
};

export const navItems = [
  { id: 'river', label: 'River Reach A', kind: 'Water body' },
  { id: 'hotspot', label: 'Contamination zone', kind: 'Alert zone' },
  { id: 'sensor', label: 'Sensor Node 04', kind: 'Sensor' },
  { id: 'reservoir', label: 'North Reservoir', kind: 'Storage' },
  { id: 'source', label: 'Industrial Site B', kind: 'Potential source' },
  { id: 'plant', label: 'Treatment plant', kind: 'Infrastructure' }
];
