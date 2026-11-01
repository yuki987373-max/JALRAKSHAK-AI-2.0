import { useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2, ZoomIn, ZoomOut } from 'lucide-react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

function labelSprite(text, color = '#86edff') {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = 'rgba(3, 16, 32, 0.9)';
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(4, 4, 504, 88, 15);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = '600 27px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(text).toUpperCase().slice(0, 28), 256, 48);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(3.2, 0.6, 1);
  return sprite;
}

function markerAt(scene, x, z, color, label) {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.58, 8), material);
  stem.position.y = 0.33;
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), new THREE.MeshBasicMaterial({ color, emissive: color }));
  orb.position.y = 0.68;
  group.add(stem, orb);
  group.position.set(x, 0, z);
  const sprite = labelSprite(label, `#${new THREE.Color(color).getHexString()}`);
  if (sprite) { sprite.position.set(0, 1.15, 0); group.add(sprite); }
  scene.add(group);
  return group;
}


function stableHash(value) {
  let hash = 0;
  for (const character of String(value || '')) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return Math.abs(hash);
}

function addContextModel(root, item, point, index) {
  const tags = item.tags || {};
  const category = item.context?.category || 'other';
  const seed = stableHash(item.id);
  const jitterX = ((seed % 11) - 5) * 0.035;
  const jitterZ = (((Math.floor(seed / 11) % 11) - 5) * 0.035);
  const x = THREE.MathUtils.clamp(point.x + jitterX, -4.75, 4.75);
  const z = THREE.MathUtils.clamp(point.z + jitterZ, -4.75, 4.75);
  const colors = {
    building: 0x8bc7e8, road: 0x8297a8, bridge: 0xffc77a, railway: 0xa9a0d9,
    'water-infrastructure': 0x51e3d1, industrial: 0xffa46f, agriculture: 0x8fca91,
    drainage: 0xffa16c, facility: 0x9dbde9, landuse: 0x7895a7, utility: 0xc2a8ff, other: 0xb6a4ff,
  };
  const color = colors[category] || colors.other;
  const material = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.22, transparent: true, opacity: 0.78, roughness: 0.55, metalness: 0.18 });
  const addBox = (width, height, depth, y, opacity = 0.78) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material.clone());
    mesh.material.opacity = opacity;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(x, y, z);
    root.add(mesh);
    const outline = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8 }));
    outline.position.copy(mesh.position);
    root.add(outline);
    return mesh;
  };
  const addLabel = (text, y = 1.0) => {
    if (index > 27) return;
    const sprite = labelSprite(text, `#${new THREE.Color(color).getHexString()}`);
    if (sprite) {
      sprite.scale.set(1.8, 0.34, 1);
      sprite.position.set(x, y, z);
      root.add(sprite);
    }
  };

  if (category === 'building') {
    const levels = Number.parseFloat(tags['building:levels']) || 1;
    const taggedHeight = Number.parseFloat(String(tags.height || '').replace(/[^0-9.]/g, ''));
    const height = THREE.MathUtils.clamp(taggedHeight ? taggedHeight * 0.12 : 0.38 + levels * 0.16, 0.42, 2.6);
    const footprint = /industrial|warehouse|retail|commercial/i.test(String(tags.building)) ? 0.72 : 0.46 + (seed % 4) * 0.07;
    const depth = footprint * (0.78 + (seed % 3) * 0.12);
    addBox(footprint, height, depth, height / 2 + 0.08);
    // Small facade windows and a roof cap make individual buildings legible at a glance.
    const windowMaterial = new THREE.MeshStandardMaterial({ color: 0x9feeff, emissive: 0x1b7eaa, emissiveIntensity: 0.65, metalness: 0.25, roughness: 0.32 });
    const floors = Math.max(1, Math.min(7, Math.round(height / 0.31)));
    const columns = footprint > 0.65 ? 3 : 2;
    for (let floor = 0; floor < floors; floor += 1) {
      for (let column = 0; column < columns; column += 1) {
        const windowMesh = new THREE.Mesh(new THREE.BoxGeometry(footprint * 0.13, 0.075, 0.018), windowMaterial);
        windowMesh.position.set(x + (column - (columns - 1) / 2) * footprint * 0.27, 0.22 + (floor + 0.5) * (height / floors), z + depth / 2 + 0.012);
        root.add(windowMesh);
      }
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(footprint * 1.04, 0.055, depth * 1.04), new THREE.MeshStandardMaterial({ color: 0x456c7e, roughness: 0.85, metalness: 0.12 }));
    roof.position.set(x, height + 0.11, z); root.add(roof);
    addLabel(item.name && !/^Unnamed/.test(item.name) ? item.name : 'BUILDING', height + 0.45);
    return;
  }
  if (category === 'road') {
    const angle = (seed % 628) / 100;
    const width = /primary|trunk|motorway/i.test(String(tags.highway)) ? 0.19 : 0.11;
    const road = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.035, width), new THREE.MeshBasicMaterial({ color: 0x667d90, transparent: true, opacity: 0.82 }));
    road.position.set(x, 0.055, z);
    road.rotation.y = angle;
    root.add(road);
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(road.geometry), new THREE.LineBasicMaterial({ color: 0x9fb5c5, transparent: true, opacity: 0.7 }));
    edge.position.copy(road.position); edge.rotation.copy(road.rotation); root.add(edge);
    const dashMaterial = new THREE.MeshBasicMaterial({ color: 0xd6e7ef, transparent: true, opacity: 0.72 });
    for (let dash = -2; dash <= 2; dash += 1) {
      const marking = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.012, 0.018), dashMaterial);
      marking.position.set(x + Math.sin(angle) * dash * 0.23, 0.078, z + Math.cos(angle) * dash * 0.23);
      marking.rotation.y = angle; root.add(marking);
    }
    addLabel('ROAD / STREET', 0.38);
    return;
  }
  if (category === 'bridge') {
    const angle = (seed % 628) / 100;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.12, 0.34), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, transparent: true, opacity: 0.9 }));
    deck.position.set(x, 0.42, z); deck.rotation.y = angle; root.add(deck);
    for (const offset of [-0.42, 0.42]) {
      const pier = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.42, 0.12), material.clone());
      pier.position.set(x + Math.cos(angle) * offset, 0.2, z - Math.sin(angle) * offset); root.add(pier);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(1.23, 0.045, 0.04), new THREE.MeshStandardMaterial({ color: 0xc8e5ed, metalness: 0.5, roughness: 0.3 }));
      rail.position.set(x + Math.cos(angle) * offset, 0.54, z - Math.sin(angle) * offset); rail.rotation.y = angle; root.add(rail);
    }
    addLabel('BRIDGE', 0.95);
    return;
  }
  if (category === 'railway') {
    const angle = (seed % 628) / 100;
    for (const offset of [-0.12, 0.12]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.045, 0.035), new THREE.MeshBasicMaterial({ color: 0xb7b4d9 }));
      rail.position.set(x + Math.sin(angle) * offset, 0.09, z + Math.cos(angle) * offset); rail.rotation.y = angle; root.add(rail);
    }
    addLabel('RAILWAY', 0.42);
    return;
  }
  if (category === 'drainage') {
    const channelMaterial = new THREE.MeshStandardMaterial({ color: 0x657f91, emissive: 0x183d50, emissiveIntensity: 0.25, roughness: 0.92, metalness: 0.08 });
    const channel = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.11, 0.24), channelMaterial);
    channel.position.set(x, 0.06, z); channel.rotation.y = (seed % 628) / 100; root.add(channel);
    const darkBed = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.018, 0.12), new THREE.MeshBasicMaterial({ color: 0x102a36 }));
    darkBed.position.set(x, 0.122, z); darkBed.rotation.y = channel.rotation.y; root.add(darkBed);
    for (let grate = -2; grate <= 2; grate += 1) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.018, 0.16), new THREE.MeshStandardMaterial({ color: 0xb9d3dc, metalness: 0.7, roughness: 0.3 }));
      bar.position.set(x + grate * 0.13, 0.14, z); bar.rotation.y = channel.rotation.y; root.add(bar);
    }
    addLabel('DRAIN / CHANNEL', 0.46);
    return;
  }
  if (category === 'water-infrastructure') {
    addBox(0.78, 0.28, 0.62, 0.18);
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.48, 24), new THREE.MeshStandardMaterial({ color: 0x59c9d9, emissive: 0x123e54, emissiveIntensity: 0.35, metalness: 0.42, roughness: 0.28 }));
    tank.position.set(x + 0.38, 0.56, z); root.add(tank);
    const tankRim = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.025, 6, 32), new THREE.MeshStandardMaterial({ color: 0xb1f1fa, metalness: 0.55, roughness: 0.22 }));
    tankRim.rotation.x = Math.PI / 2; tankRim.position.set(x + 0.38, 0.81, z); root.add(tankRim);
    addLabel('WATER INFRA', 1.25);
    return;
  }
  if (category === 'industrial') {
    addBox(0.92, 0.48, 0.72, 0.32);
    const warehouse = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.36, 0.54), material.clone());
    warehouse.position.set(x + 0.48, 0.26, z + 0.38); root.add(warehouse);
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.12, 1.08, 12), material.clone());
    stack.position.set(x - 0.3, 0.78, z - 0.23); root.add(stack);
    const stackCap = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.018, 6, 18), new THREE.MeshStandardMaterial({ color: 0xffd2a0, emissive: 0x713f22, emissiveIntensity: 0.35 }));
    stackCap.position.set(x - 0.3, 1.33, z - 0.23); stackCap.rotation.x = Math.PI / 2; root.add(stackCap);
    addLabel('INDUSTRIAL SITE', 1.55);
    return;
  }
  if (category === 'facility') {
    addBox(0.72, 0.4, 0.66, 0.28);
    // A pair of clarifier tanks and a small process building are schematic treatment assets.
    for (const offset of [-0.33, 0.34]) {
      const clarifier = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.13, 24), new THREE.MeshStandardMaterial({ color: 0x5eafbb, emissive: 0x0b3443, emissiveIntensity: 0.28, metalness: 0.28, roughness: 0.32 }));
      clarifier.position.set(x + offset, 0.2, z + 0.54); root.add(clarifier);
      const lip = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.018, 6, 24), new THREE.MeshStandardMaterial({ color: 0xb9eff4, metalness: 0.45, roughness: 0.25 }));
      lip.rotation.x = Math.PI / 2; lip.position.set(x + offset, 0.27, z + 0.54); root.add(lip);
    }
    addLabel('FACILITY / TREATMENT', 1.1);
    return;
  }
  if (category === 'utility') {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.07, 1.2, 8), material.clone());
    pole.position.set(x, 0.61, z); root.add(pole);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.05, 0.06), material.clone());
    arm.position.set(x, 1.08, z); root.add(arm);
    for (const offset of [-0.27, 0, 0.27]) {
      const insulator = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.13, 8), new THREE.MeshStandardMaterial({ color: 0xd9e9ee, roughness: 0.4 }));
      insulator.position.set(x + offset, 1.17, z); root.add(insulator);
    }
    addLabel('UTILITY', 1.48);
    return;
  }
  if (category === 'agriculture') {
    const field = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.025, 0.7), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, wireframe: true }));
    field.position.set(x, 0.015, z); root.add(field);
    addLabel('FARMLAND', 0.45);
    return;
  }
  if (category === 'landuse') {
    const patch = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.018, 0.68), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, wireframe: true }));
    patch.position.set(x, 0.012, z); root.add(patch);
    addLabel('BUILT-UP AREA', 0.42);
    return;
  }

  const marker = new THREE.Mesh(new THREE.SphereGeometry(0.105, 12, 10), new THREE.MeshBasicMaterial({ color, emissive: color }));
  marker.position.set(x, 0.3, z);
  root.add(marker);
  addLabel(item.context?.label || 'MAPPED FEATURE', 0.75);
}


function sceneCoordinate(lon, lat, origin, radiusM) {
  const scale = Math.max(100, Number(radiusM) || 5000);
  const x = ((lon - origin.lon) * 111320 * Math.cos(origin.lat * Math.PI / 180) / scale) * 5;
  const z = -((lat - origin.lat) * 110540 / scale) * 5;
  return { x: THREE.MathUtils.clamp(x, -5.35, 5.35), z: THREE.MathUtils.clamp(z, -5.35, 5.35) };
}

function polygonParts(geometry, output = []) {
  if (!geometry) return output;
  if (geometry.type === 'Polygon') output.push(geometry.coordinates || []);
  else if (geometry.type === 'MultiPolygon') output.push(...(geometry.coordinates || []));
  else if (geometry.type === 'GeometryCollection') (geometry.geometries || []).forEach(item => polygonParts(item, output));
  return output;
}

function lineParts(geometry, output = []) {
  if (!geometry) return output;
  if (geometry.type === 'LineString') output.push(geometry.coordinates || []);
  else if (geometry.type === 'MultiLineString') output.push(...(geometry.coordinates || []));
  else if (geometry.type === 'GeometryCollection') (geometry.geometries || []).forEach(item => lineParts(item, output));
  return output;
}

function ringToPath(ring, origin, radiusM, PathClass = THREE.Path) {
  if (!Array.isArray(ring) || ring.length < 3) return null;
  const path = new PathClass();
  ring.forEach((coord, index) => {
    if (!Array.isArray(coord) || coord.length < 2) return;
    const p = sceneCoordinate(Number(coord[0]), Number(coord[1]), origin, radiusM);
    const sx = p.x;
    const sy = -p.z;
    if (index === 0) path.moveTo(sx, sy);
    else path.lineTo(sx, sy);
  });
  path.closePath();
  return path;
}

function addGeoJSONWaterGeometry(root, geometry, origin, radiusM, material) {
  const meshes = [];
  for (const polygon of polygonParts(geometry)) {
    if (!polygon?.[0]?.length) continue;
    const shape = ringToPath(polygon[0], origin, radiusM, THREE.Shape);
    if (!shape) continue;
    for (const holeRing of polygon.slice(1)) {
      const hole = ringToPath(holeRing, origin, radiusM, THREE.Path);
      if (hole) shape.holes.push(hole);
    }
    const meshGeometry = new THREE.ShapeGeometry(shape, 12);
    meshGeometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(meshGeometry, material.clone());
    mesh.position.y = 0.22;
    mesh.receiveShadow = true;
    mesh.userData.jalrakshakGeometrySource = 'Imported polygon geometry';
    root.add(mesh);
    meshes.push(mesh);
  }
  for (const line of lineParts(geometry)) {
    if (!Array.isArray(line) || line.length < 2) continue;
    const step = Math.max(1, Math.ceil(line.length / 900));
    const selected = line.filter((_, index) => index % step === 0);
    if (selected.length && selected[selected.length - 1] !== line[line.length - 1]) selected.push(line[line.length - 1]);
    const points = selected.map(coord => {
      const p = sceneCoordinate(Number(coord[0]), Number(coord[1]), origin, radiusM);
      return new THREE.Vector3(p.x, 0.22, p.z);
    });
    if (points.length < 2) continue;
    const curve = new THREE.CatmullRomCurve3(points);
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(18, points.length * 3), 0.105, 8, false), material.clone());
    mesh.receiveShadow = true;
    mesh.userData.jalrakshakGeometrySource = 'Imported line geometry';
    root.add(mesh);
    meshes.push(mesh);
  }
  return meshes;
}

function addGeoJSONContextGeometry(root, item, origin, radiusM, index) {
  const geometry = item.geometry;
  if (!geometry) return [];
  const category = item.context?.category || 'other';
  const colorMap = {
    building: 0x8bc7e8, industrial: 0xffa46f, road: 0x8297a8, railway: 0xa9a0d9,
    drainage: 0xffa16c, facility: 0x9dbde9, 'water-infrastructure': 0x51e3d1,
    agriculture: 0x8fca91, landuse: 0x7895a7, utility: 0xc2a8ff, other: 0xb6a4ff,
  };
  const color = colorMap[category] || colorMap.other;
  const meshes = [];
  const tags = item.tags || {};
  for (const polygon of polygonParts(geometry)) {
    if (!polygon?.[0]?.length) continue;
    const shape = ringToPath(polygon[0], origin, radiusM, THREE.Shape);
    if (!shape) continue;
    for (const holeRing of polygon.slice(1)) {
      const hole = ringToPath(holeRing, origin, radiusM, THREE.Path);
      if (hole) shape.holes.push(hole);
    }
    let geometry3d;
    let material;
    if (['building', 'industrial', 'facility', 'water-infrastructure'].includes(category)) {
      const actualHeight = Number.parseFloat(String(tags.height || '').replace(/[^0-9.]/g, ''));
      const levels = Number.parseFloat(tags['building:levels']) || 1;
      const height = THREE.MathUtils.clamp(actualHeight ? actualHeight * 0.085 : 0.28 + levels * 0.12, 0.28, 1.9);
      geometry3d = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, steps: 1, curveSegments: 6 });
      material = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.13, roughness: 0.76, metalness: 0.08, transparent: true, opacity: 0.88 });
    } else {
      geometry3d = new THREE.ShapeGeometry(shape, 8);
      material = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.08, roughness: 0.9, side: THREE.DoubleSide, transparent: true, opacity: category === 'agriculture' || category === 'landuse' ? 0.23 : 0.58, depthWrite: false });
    }
    geometry3d.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry3d, material);
    mesh.position.y = ['building', 'industrial', 'facility', 'water-infrastructure'].includes(category) ? 0.04 : 0.025;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.jalrakshakGeometrySource = 'Imported polygon geometry';
    root.add(mesh);
    meshes.push(mesh);
  }
  for (const line of lineParts(geometry)) {
    if (!Array.isArray(line) || line.length < 2) continue;
    const step = Math.max(1, Math.ceil(line.length / 700));
    const selected = line.filter((_, idx) => idx % step === 0);
    if (selected.length && selected[selected.length - 1] !== line[line.length - 1]) selected.push(line[line.length - 1]);
    const points = selected.map(coord => {
      const p = sceneCoordinate(Number(coord[0]), Number(coord[1]), origin, radiusM);
      return new THREE.Vector3(p.x, category === 'road' || category === 'railway' ? 0.075 : 0.10, p.z);
    });
    if (points.length < 2) continue;
    const radius = category === 'road' ? 0.055 : category === 'railway' ? 0.025 : category === 'drainage' ? 0.048 : 0.035;
    const curve = new THREE.CatmullRomCurve3(points);
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(16, points.length * 2), radius, 6, false), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.12, roughness: 0.82, transparent: true, opacity: 0.9 }));
    mesh.userData.jalrakshakGeometrySource = 'Imported line geometry';
    root.add(mesh);
    meshes.push(mesh);
  }
  if (meshes.length && index < 18) {
    const p = sceneCoordinate(item.lon, item.lat, origin, radiusM);
    const sprite = labelSprite(item.name && !/^Unnamed/i.test(item.name) ? item.name : item.context?.label || 'Mapped feature', `#${new THREE.Color(color).getHexString()}`);
    if (sprite) { sprite.scale.set(1.75, 0.32, 1); sprite.position.set(p.x, 0.95, p.z); root.add(sprite); }
  }
  return meshes;
}

function distanceMeters(a, b) {
  if (!a || !b) return null;
  const rad = value => value * Math.PI / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const lat1 = rad(a.lat);
  const lat2 = rad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

function displayDistance(value) {
  if (!Number.isFinite(value)) return 'Not available';
  return value >= 1000 ? `${(value / 1000).toFixed(2)} km` : `${Math.round(value)} m`;
}

function usefulTags(tags = {}) {
  const preferred = [
    'natural', 'water', 'waterway', 'landuse', 'man_made', 'building', 'building:part',
    'building:levels', 'height', 'amenity', 'industrial', 'highway', 'railway', 'bridge',
    'power', 'operator', 'usage', 'intermittent', 'seasonal', 'source', 'reservoir_type',
    'width', 'depth', 'surface', 'access', 'description',
  ];
  return preferred.filter(key => tags[key] != null && String(tags[key]).trim() !== '')
    .slice(0, 12)
    .map(key => ({ key, value: String(tags[key]) }));
}

function waterBodyDetails(waterBody, origin) {
  const tags = waterBody.tags || {};
  const mappedType = tags.waterway || tags.water || tags.natural || tags.landuse || waterBody.kind || 'mapped water feature';
  return {
    id: waterBody.id,
    objectType: 'waterbody',
    category: 'Water body',
    title: waterBody.name || waterBody.kind || 'Unnamed mapped water body',
    subtitle: `${waterBody.kind || 'Water feature'} · primary feature`,
    lat: waterBody.lat,
    lon: waterBody.lon,
    tags,
    tagItems: usefulTags(tags),
    distanceFromOrigin: distanceMeters(origin, { lat: waterBody.lat, lon: waterBody.lon }),
    distanceFromWater: 0,
    explanation: `OpenStreetMap classifies this feature as “${mappedType}”. This identifies its mapped geographic type only; it does not reveal its current source, flow, ownership, water-quality condition, or whether it is safe for any use.`,
    relevance: 'This is the selected water body. Use sensor readings and suitable laboratory tests to assess its actual condition.',
    mapUrl: waterBody.mapUrl,
  };
}

function contextObjectDetails(item, waterBody, origin) {
  const tags = item.tags || {};
  const context = item.context || {};
  const featurePoint = { lat: item.lat, lon: item.lon };
  const label = context.label || 'Mapped nearby feature';
  const description = context.explanation || 'This feature is mapped nearby. Its actual condition and function should be confirmed in the field.';
  const category = context.category || 'other';
  const typeTag = context.tag || Object.entries(tags).slice(0, 1).map(([key, value]) => `${key}=${value}`)[0] || 'No descriptive tag';
  let relevance = 'Its proximity is geographic context only. The map does not prove a physical connection or an effect on the selected water body.';
  if (category === 'drainage') relevance = 'Check its direction, outfall, and contents in the field. Proximity alone does not prove that it discharges into the selected water body.';
  if (category === 'industrial' || category === 'facility') relevance = 'Review verified permits, discharge records, drainage connections, and monitoring data. A mapped facility is not evidence that it is polluting the water.';
  if (category === 'water-infrastructure') relevance = 'This may be relevant to water supply or treatment infrastructure. Confirm the asset’s role and its actual network connections.';
  if (category === 'agriculture') relevance = 'Agricultural land can be relevant to runoff investigations. Check slope, drainage routes, rainfall, and field evidence before drawing conclusions.';
  return {
    id: item.id,
    objectType: 'context',
    category: label,
    title: item.name && !/^Unnamed mapped feature$/i.test(item.name) ? item.name : `${label} · ${item.osmType}/${item.osmId}`, 
    subtitle: `${label} · ${typeTag}`,
    lat: item.lat,
    lon: item.lon,
    tags,
    tagItems: usefulTags(tags),
    distanceFromOrigin: distanceMeters(origin, featurePoint),
    distanceFromWater: distanceMeters({ lat: waterBody.lat, lon: waterBody.lon }, featurePoint),
    explanation: description,
    relevance,
    mapUrl: item.mapUrl,
  };
}

export default function LocationWaterHologram({ waterBody, contextFeatures = [], origin, radiusM = 1500, selectedObjectId = null, onSelectObject }) {
  const mountRef = useRef(null);
  const wrapRef = useRef(null);
  const selectionFocusRef = useRef(null);
  const zoomControlRef = useRef(null);
  const onSelectObjectRef = useRef(onSelectObject);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [renderError, setRenderError] = useState(false);
  const [selectedObject, setSelectedObject] = useState(() => waterBody && origin ? waterBodyDetails(waterBody, origin) : null);

  useEffect(() => { onSelectObjectRef.current = onSelectObject; }, [onSelectObject]);
  useEffect(() => {
    const syncFullscreen = () => setIsFullscreen(Boolean(document.fullscreenElement && (document.fullscreenElement === wrapRef.current || document.fullscreenElement.contains(wrapRef.current))));
    document.addEventListener('fullscreenchange', syncFullscreen);
    syncFullscreen();
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);
  const toggleFullscreen = async () => {
    const element = wrapRef.current;
    if (!element) return;
    try {
      if (document.fullscreenElement === element || document.fullscreenElement?.contains(element)) await document.exitFullscreen();
      else await element.requestFullscreen();
    } catch { /* Full-screen can be blocked by browser policy; the embedded view remains available. */ }
  };

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !waterBody || !origin) return undefined;
    let renderer;
    let animationFrame = 0;
    let resizeObserver;
    let controls;
    let scene;
    let camera;
    let root;
    const clickableObjects = [];
    const featureDetailsById = new Map();
    let selectionRing;
    let pointerDown = null;
    let removeCanvasInteractions = null;
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const disposeTree = (object) => object.traverse(child => {
      child.geometry?.dispose?.();
      if (Array.isArray(child.material)) child.material.forEach(material => { material.map?.dispose?.(); material.dispose?.(); });
      else if (child.material) { child.material.map?.dispose?.(); child.material.dispose?.(); }
    });

    try {
      setRenderError(false);
      scene = new THREE.Scene();
      scene.background = new THREE.Color('#04111f');
      scene.fog = new THREE.Fog('#04111f', 10, 26);
      camera = new THREE.PerspectiveCamera(42, Math.max(1, mount.clientWidth) / Math.max(1, mount.clientHeight), 0.1, 80);
      camera.position.set(0.2, 6.5, 8.8);
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      renderer.setSize(Math.max(1, mount.clientWidth), Math.max(1, mount.clientHeight));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.domElement.tabIndex = 0;
      renderer.domElement.setAttribute('aria-label', `Schematic 3D hologram for ${waterBody.name}`);
      renderer.domElement.setAttribute('tabindex', '0');
      renderer.domElement.setAttribute('title', 'Click to inspect · R zooms in · F zooms out');
      mount.appendChild(renderer.domElement);
      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.07;
      controls.minDistance = 4.5;
      controls.maxDistance = 17;
      controls.maxPolarAngle = Math.PI * 0.48;
      controls.target.set(0, 0.2, 0);
      const zoomCamera = directionName => {
        const direction = camera.position.clone().sub(controls.target);
        const currentDistance = direction.length();
        const nextDistance = THREE.MathUtils.clamp(currentDistance * (directionName === 'in' ? 0.82 : 1.22), controls.minDistance, controls.maxDistance);
        direction.setLength(nextDistance);
        camera.position.copy(controls.target.clone().add(direction));
        controls.update();
      };
      zoomControlRef.current = zoomCamera;

      scene.add(new THREE.HemisphereLight(0x9bdff2, 0x153d36, 1.35));
      const keyLight = new THREE.DirectionalLight(0xc9f4ff, 2.15);
      keyLight.position.set(5, 10, 4);
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(1024, 1024);
      keyLight.shadow.camera.left = -8; keyLight.shadow.camera.right = 8;
      keyLight.shadow.camera.top = 8; keyLight.shadow.camera.bottom = -8;
      scene.add(keyLight);
      const aquaLight = new THREE.PointLight(0x0a96c9, 24, 25);
      aquaLight.position.set(-5, 3, -4);
      scene.add(aquaLight);

      root = new THREE.Group();
      scene.add(root);
      // Low-poly terrain adds relief without pretending the schematic is a surveyed DEM.
      const terrainGeometry = new THREE.PlaneGeometry(13, 13, 42, 42);
      const terrainPositions = terrainGeometry.attributes.position;
      for (let vertex = 0; vertex < terrainPositions.count; vertex += 1) {
        const tx = terrainPositions.getX(vertex);
        const tz = terrainPositions.getY(vertex);
        const ridge = Math.sin(tx * 0.72) * Math.cos(tz * 0.54) * 0.09;
        const undulation = Math.sin((tx + tz) * 1.25) * 0.035;
        terrainPositions.setZ(vertex, ridge + undulation);
      }
      terrainGeometry.computeVertexNormals();
      const terrain = new THREE.Mesh(terrainGeometry, new THREE.MeshStandardMaterial({ color: 0x214c43, roughness: 0.98, metalness: 0.02, flatShading: true }));
      terrain.rotation.x = -Math.PI / 2;
      terrain.position.y = -0.12;
      terrain.receiveShadow = true;
      root.add(terrain);
      const grid = new THREE.GridHelper(14, 28, 0x18728f, 0x13344a);
      grid.position.y = -0.05;
      grid.material.transparent = true;
      grid.material.opacity = 0.65;
      root.add(grid);
      const platform = new THREE.Mesh(
        new THREE.CircleGeometry(6.2, 72),
        new THREE.MeshBasicMaterial({ color: 0x072637, transparent: true, opacity: 0.34, side: THREE.DoubleSide })
      );
      platform.rotation.x = -Math.PI / 2;
      platform.position.y = -0.08;
      root.add(platform);
      const outerRing = new THREE.Mesh(new THREE.TorusGeometry(5.1, 0.018, 4, 100), new THREE.MeshBasicMaterial({ color: 0x1abde5, transparent: true, opacity: 0.7 }));
      outerRing.rotation.x = Math.PI / 2;
      outerRing.position.y = 0.02;
      root.add(outerRing);
      // Decorative trees provide environmental context; they are illustrative and are not mapped assets.
      const treePositions = [[-5.0,-3.4],[-4.7,2.8],[-3.6,4.5],[-1.7,-4.8],[2.9,-4.5],[4.8,-2.8],[4.9,3.4],[2.8,4.7],[-5.2,0.4]];
      treePositions.forEach(([tx, tz], treeIndex) => {
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.075, 0.42, 7), new THREE.MeshStandardMaterial({ color: 0x705d47, roughness: 1 }));
        trunk.position.set(tx, 0.12, tz); root.add(trunk);
        const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(0.24 + (treeIndex % 3) * 0.035, 1), new THREE.MeshStandardMaterial({ color: treeIndex % 2 ? 0x3f9275 : 0x4ba17c, roughness: 0.96, flatShading: true }));
        crown.position.set(tx, 0.45, tz); crown.scale.y = 1.15; root.add(crown);
      });

      const { x: bodyX, z: bodyZ } = sceneCoordinate(waterBody.lon, waterBody.lat, origin, radiusM);
      const position = (feature) => sceneCoordinate(feature.lon, feature.lat, origin, radiusM);

      const waterMaterial = new THREE.MeshPhysicalMaterial({ color: 0x178eae, emissive: 0x033047, emissiveIntensity: 0.42, transparent: true, opacity: 0.88, roughness: 0.14, metalness: 0.08, clearcoat: 0.9, clearcoatRoughness: 0.12, side: THREE.DoubleSide });
      const kind = String(waterBody.kind || '').toLowerCase();
      let waterMesh = null;
      const actualWaterMeshes = addGeoJSONWaterGeometry(root, waterBody.geometry, origin, radiusM, waterMaterial);
      if (actualWaterMeshes.length) {
        waterMesh = actualWaterMeshes[0];
      } else {
        // Fallback schematic is used only when a source feature has no polygon/line geometry.
        if (/river|stream|canal|channel|waterway/.test(kind)) {
          const pts = [new THREE.Vector3(-2.2, 0.22, 0.42), new THREE.Vector3(-1.3, 0.24, -0.2), new THREE.Vector3(-0.2, 0.23, 0.35), new THREE.Vector3(0.9, 0.22, -0.25), new THREE.Vector3(2.3, 0.24, 0.05)];
          const curve = new THREE.CatmullRomCurve3(pts);
          waterMesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 64, 0.24, 10, false), waterMaterial);
        } else {
          waterMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 18), waterMaterial);
          const scale = /reservoir/.test(kind) ? [2.25, 0.11, 1.55] : /lake|wetland|basin|lagoon/.test(kind) ? [1.95, 0.10, 1.42] : [1.35, 0.095, 1.0];
          waterMesh.scale.set(...scale);
        }
        waterMesh.position.set(bodyX, 0.22, bodyZ);
        waterMesh.receiveShadow = true;
        root.add(waterMesh);
      }
      const waterDetails = waterBodyDetails(waterBody, origin);
      featureDetailsById.set(waterDetails.id, waterDetails);
      const waterMeshesToSelect = actualWaterMeshes.length ? actualWaterMeshes : [waterMesh];
      waterMeshesToSelect.forEach(mesh => {
        mesh.userData.jalrakshakFeature = waterDetails;
        clickableObjects.push(mesh);
      });
      if (!actualWaterMeshes.length) {
        // A slightly larger invisible target makes schematic water features easier to select.
        const waterHitTarget = new THREE.Mesh(
          /river|stream|canal|channel|waterway/.test(kind)
            ? new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
                new THREE.Vector3(-2.2, 0.22, 0.42), new THREE.Vector3(-1.3, 0.24, -0.2),
                new THREE.Vector3(-0.2, 0.23, 0.35), new THREE.Vector3(0.9, 0.22, -0.25),
                new THREE.Vector3(2.3, 0.24, 0.05),
              ]), 64, 0.42, 10, false)
            : new THREE.SphereGeometry(1, 32, 16),
          new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, colorWrite: false, depthWrite: false, side: THREE.DoubleSide })
        );
        waterHitTarget.position.copy(waterMesh.position);
        if (!/river|stream|canal|channel|waterway/.test(kind)) waterHitTarget.scale.copy(waterMesh.scale).multiply(new THREE.Vector3(1.18, 5, 1.18));
        waterHitTarget.userData.jalrakshakFeature = waterDetails;
        root.add(waterHitTarget);
        clickableObjects.push(waterHitTarget);
      }
      if (!actualWaterMeshes.length && !/river|stream|canal|channel|waterway/.test(kind)) {
        const shore = new THREE.Mesh(new THREE.TorusGeometry(/reservoir|lake|wetland/.test(kind) ? 1.85 : 1.25, 0.022, 4, 80), new THREE.MeshBasicMaterial({ color: 0x60ebff, transparent: true, opacity: 0.82 }));
        shore.rotation.x = Math.PI / 2;
        shore.scale.set(/reservoir/.test(kind) ? 1.2 : 1, 1, /reservoir|lake|wetland/.test(kind) ? 0.74 : 0.62);
        shore.position.set(bodyX, 0.24, bodyZ);
        root.add(shore);
      }
      const waterLabel = labelSprite(waterBody.name || waterBody.kind || 'Water body');
      if (waterLabel) { waterLabel.position.set(bodyX, 1.1, bodyZ); root.add(waterLabel); }

      // The supplied coordinate is shown separately from the mapped water feature.
      markerAt(root, 0, 0, 0x75efff, 'SUPPLIED POINT');
      contextFeatures.forEach((item, index) => {
        const p = position(item);
        const featureGroup = new THREE.Group();
        const detail = contextObjectDetails(item, waterBody, origin);
        featureDetailsById.set(detail.id, detail);
        const geometryMeshes = addGeoJSONContextGeometry(featureGroup, item, origin, radiusM, index);
        if (geometryMeshes.length) {
          geometryMeshes.forEach(mesh => {
            mesh.userData.jalrakshakFeature = detail;
            clickableObjects.push(mesh);
          });
        } else {
          addContextModel(featureGroup, item, p, index);
          const seed = stableHash(item.id);
          const clickX = THREE.MathUtils.clamp(p.x + ((seed % 11) - 5) * 0.035, -4.75, 4.75);
          const clickZ = THREE.MathUtils.clamp(p.z + ((Math.floor(seed / 11) % 11) - 5) * 0.035, -4.75, 4.75);
          const category = item.context?.category || 'other';
          const hitGeometry = category === 'road' || category === 'railway'
            ? new THREE.BoxGeometry(1.55, 0.85, 0.72)
            : new THREE.SphereGeometry(category === 'building' || category === 'industrial' || category === 'facility' ? 0.48 : 0.36, 12, 10);
          const hitTarget = new THREE.Mesh(hitGeometry, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, colorWrite: false, depthWrite: false }));
          hitTarget.position.set(clickX, category === 'road' || category === 'railway' ? 0.42 : 0.55, clickZ);
          hitTarget.userData.jalrakshakFeature = detail;
          featureGroup.add(hitTarget);
          clickableObjects.push(hitTarget);
        }
        root.add(featureGroup);
      });

      // A glowing ring marks whichever mapped feature the user has selected.
      selectionRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.42, 0.028, 6, 48),
        new THREE.MeshBasicMaterial({ color: 0x7ff7ff, transparent: true, opacity: 0.95, depthWrite: false })
      );
      selectionRing.rotation.x = Math.PI / 2;
      selectionRing.position.set(bodyX, 0.27, bodyZ);
      selectionRing.visible = false;
      root.add(selectionRing);

      const focusObject = (detail, notifyParent = true) => {
        if (!detail) return;
        setSelectedObject(detail);
        if (notifyParent) onSelectObjectRef.current?.(detail.id, detail);
        if (selectionRing && Number.isFinite(detail.lat) && Number.isFinite(detail.lon)) {
          const focus = detail.objectType === 'waterbody' ? { x: bodyX, z: bodyZ } : position({ lat: detail.lat, lon: detail.lon });
          selectionRing.position.set(focus.x, 0.27, focus.z);
          selectionRing.scale.setScalar(detail.objectType === 'waterbody' ? 1.25 : 0.85);
          selectionRing.visible = true;
          const nextTarget = new THREE.Vector3(focus.x, 0.22, focus.z);
          const cameraOffset = camera.position.clone().sub(controls.target);
          controls.target.copy(nextTarget);
          camera.position.copy(nextTarget.clone().add(cameraOffset));
          controls.update();
        }
      };
      selectionFocusRef.current = (id) => focusObject(featureDetailsById.get(id), true);
      focusObject(featureDetailsById.get(selectedObjectId) || waterDetails, Boolean(selectedObjectId));
      root.traverse(object => {
        if (!object.isMesh) return;
        const materialList = Array.isArray(object.material) ? object.material : [object.material];
        if (materialList.some(material => material && material.transparent !== true && material.type !== 'MeshBasicMaterial')) object.castShadow = true;
      });

      const selectAtCanvasPosition = (event) => {
        const rect = renderer.domElement.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        const intersections = raycaster.intersectObjects(clickableObjects, false);
        return intersections.find(hit => hit.object.userData.jalrakshakFeature)?.object || null;
      };
      const handlePointerDown = (event) => {
        if (event.button !== 0) return;
        renderer.domElement.focus({ preventScroll: true });
        pointerDown = { x: event.clientX, y: event.clientY, moved: false };
      };
      const handleKeyDown = (event) => {
        if (event.ctrlKey || event.altKey || event.metaKey || event.repeat) return;
        const key = event.key.toLowerCase();
        if (key !== 'r' && key !== 'f') return;
        event.preventDefault();
        zoomCamera(key === 'r' ? 'in' : 'out');
      };
      const handlePointerMove = (event) => {
        if (pointerDown && Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 5) pointerDown.moved = true;
        if (pointerDown?.moved) return;
        const hit = selectAtCanvasPosition(event);
        renderer.domElement.style.cursor = hit ? 'pointer' : 'grab';
      };
      const handlePointerUp = (event) => {
        if (!pointerDown) return;
        const moved = pointerDown.moved || Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 5;
        pointerDown = null;
        if (moved || event.button !== 0) return;
        const hit = selectAtCanvasPosition(event);
        if (!hit) return;
        const detail = hit.userData.jalrakshakFeature;
        focusObject(detail);
      };
      renderer.domElement.addEventListener('pointerdown', handlePointerDown);
      renderer.domElement.addEventListener('keydown', handleKeyDown);
      renderer.domElement.addEventListener('pointermove', handlePointerMove);
      renderer.domElement.addEventListener('pointerup', handlePointerUp);
      removeCanvasInteractions = () => {
        selectionFocusRef.current = null;
        zoomControlRef.current = null;
        renderer?.domElement?.removeEventListener('pointerdown', handlePointerDown);
        renderer?.domElement?.removeEventListener('keydown', handleKeyDown);
        renderer?.domElement?.removeEventListener('pointermove', handlePointerMove);
        renderer?.domElement?.removeEventListener('pointerup', handlePointerUp);
      };

      resizeObserver = new ResizeObserver(() => {
        if (!mount || !renderer || !camera) return;
        const width = Math.max(1, mount.clientWidth);
        const height = Math.max(1, mount.clientHeight);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
      });
      resizeObserver.observe(mount);
      const animate = () => {
        animationFrame = requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
      };
      animate();
    } catch (error) {
      console.warn('Location hologram renderer unavailable:', error);
      setRenderError(true);
    }

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      removeCanvasInteractions?.();
      controls?.dispose();
      if (scene) disposeTree(scene);
      if (renderer) {
        renderer.dispose();
        renderer.domElement?.remove();
      }
    };
  }, [waterBody?.id, waterBody?.kind, waterBody?.lat, waterBody?.lon, waterBody?.name, waterBody?.geometry, origin?.lat, origin?.lon, radiusM, contextFeatures]);

  useEffect(() => {
    if (selectedObjectId) selectionFocusRef.current?.(selectedObjectId);
  }, [selectedObjectId]);

  if (!waterBody) return null;
  return <div ref={wrapRef} className={`location-hologram-wrap central-hologram ${isFullscreen ? 'is-fullscreen' : ''}`}>
    <div className="location-hologram-caption"><span className="holo-pulse" /> LOCATION DIGITAL TWIN · {waterBody.name || waterBody.kind}
      <small>{contextFeatures.length} MAPPED FEATURES · {waterBody.geometry ? 'SOURCE GEOMETRY + 3D EXTRUSIONS' : 'WATERBODY SHAPE IS SCHEMATIC; CONTEXT OBJECTS USE MAPPED POSITIONS'}</small>
      <div className="hologram-view-controls">
        <button type="button" className="hologram-fullscreen-button" onClick={() => zoomControlRef.current?.('in')} title="Zoom in"><ZoomIn size={14} /> Zoom in</button>
        <button type="button" className="hologram-fullscreen-button" onClick={() => zoomControlRef.current?.('out')} title="Zoom out"><ZoomOut size={14} /> Zoom out</button>
      </div>
      <span className="hologram-keyboard-hint">Scroll to zoom · R zoom in · F zoom out</span>
      <button type="button" className="hologram-fullscreen-button" onClick={toggleFullscreen} title={isFullscreen ? 'Exit full screen' : 'Open hologram full screen'}>
        {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}{isFullscreen ? 'Exit' : 'Full screen'}
      </button>
    </div>
    <div className="location-hologram-canvas" ref={mountRef}>
      {renderError && <div className="hologram-fallback">3D rendering is unavailable in this browser. The mapped water-body details are still available below.</div>}
      {!renderError && <div className="hologram-click-hint">CLICK THE WATER OR ANY BUILDING / INFRASTRUCTURE TO INSPECT</div>}
    </div>
    {selectedObject && <aside className="hologram-object-inspector" aria-live="polite">
      <div className="hologram-inspector-head">
        <div><span className="hologram-inspector-eyebrow">SELECTED 3D OBJECT</span><span className="hologram-inspector-type">{selectedObject.category}</span></div>
        <button type="button" className="hologram-inspector-close" onClick={() => setSelectedObject(null)} aria-label="Close object details">×</button>
      </div>
      <h4>{selectedObject.title}</h4>
      <p className="hologram-inspector-subtitle">{selectedObject.subtitle}</p>
      <div className="hologram-inspector-coordinates">
        <span>LAT {Number(selectedObject.lat).toFixed(5)}</span>
        <span>LON {Number(selectedObject.lon).toFixed(5)}</span>
      </div>
      <p className="hologram-inspector-description">{selectedObject.explanation}</p>
      <div className="hologram-inspector-relevance"><strong>Relation to selected water body</strong><span>{selectedObject.relevance}</span></div>
      <div className="hologram-inspector-distances">
        <span>From searched point <b>{displayDistance(selectedObject.distanceFromOrigin)}</b></span>
        <span>From water body <b>{displayDistance(selectedObject.distanceFromWater)}</b></span>
      </div>
      {selectedObject.tagItems?.length > 0 && <div className="hologram-inspector-tags"><strong>Mapped details</strong><div>{selectedObject.tagItems.map(tag => <span key={tag.key}><b>{tag.key}</b> {tag.value}</span>)}</div></div>}
      <div className="hologram-inspector-actions">
        {selectedObject.mapUrl && <a href={selectedObject.mapUrl} target="_blank" rel="noreferrer">Open object map ↗</a>}
        <button type="button" onClick={() => selectionFocusRef.current?.(waterBody.id)}>Show water source</button>
      </div>
      <small className="hologram-inspector-disclaimer">Map-derived descriptions only. Proximity does not prove a pipe, drain, discharge, or pollution connection. Water quality requires measurements and appropriate lab tests.</small>
    </aside>}
    <div className="location-hologram-legend"><span><i className="holo-water" /> Water body</span><span><i className="holo-origin" /> Your location</span><span><i className="holo-context" /> Buildings</span><span><i className="holo-infra" /> Roads / infrastructure / mapped context</span><span>Click any model to inspect</span></div>
  </div>;
}
