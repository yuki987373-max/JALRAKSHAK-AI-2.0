import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { siteData } from '../data.js';

function layerForId(id) {
  if (id === 'hotspot') return 'alert zones';
  if (id === 'sensor') return 'water quality';
  if (['source', 'reservoir', 'plant'].includes(id)) return 'infrastructure';
  return 'context';
}

function markSelectable(root, id) {
  const layer = layerForId(id);
  root.userData.selectionId = id;
  root.userData.layer = layer;
  root.traverse((child) => {
    if (child.isMesh || child.isSprite) {
      child.userData.selectionId = id;
      child.userData.layer = layer;
    }
  });
}

function addEdges(mesh, color = 0x47dfff, opacity = 0.8) {
  const edge = new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity })
  );
  edge.position.copy(mesh.position);
  edge.rotation.copy(mesh.rotation);
  edge.scale.copy(mesh.scale);
  edge.renderOrder = 5;
  mesh.parent?.add(edge);
  return edge;
}

function makeLabelSprite(text, color = '#8cecff') {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(3, 19, 35, 0.84)';
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(5, 5, 502, 86, 18);
  ctx.fill();
  ctx.stroke();
  ctx.font = '600 32px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, 256, 48);
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(3.2, 0.6, 1);
  return sprite;
}

function makeRibbon(points, width, material) {
  const vertices = [];
  const indices = [];
  for (let i = 0; i < points.length; i += 1) {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    const tangentX = next.x - prev.x;
    const tangentZ = next.z - prev.z;
    const len = Math.max(0.0001, Math.hypot(tangentX, tangentZ));
    const sideX = -tangentZ / len;
    const sideZ = tangentX / len;
    vertices.push(points[i].x + sideX * width * 0.5, points[i].y, points[i].z + sideZ * width * 0.5);
    vertices.push(points[i].x - sideX * width * 0.5, points[i].y, points[i].z - sideZ * width * 0.5);
    if (i < points.length - 1) {
      const k = i * 2;
      indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
}

function buildTree(scene, x, z, scale = 1) {
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.07 * scale, 0.1 * scale, 0.55 * scale, 7), new THREE.MeshStandardMaterial({ color: 0x4a856f, roughness: 1 }));
  trunk.position.set(x, 0.2 + 0.275 * scale, z);
  const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34 * scale, 1), new THREE.MeshStandardMaterial({ color: 0x0e8b78, roughness: 0.72, emissive: 0x003c42 }));
  crown.position.set(x, 0.47 * scale + 0.2, z);
  scene.add(trunk, crown);
}

function buildBuilding(scene, { x, z, w, h, d, color = 0x173c58, id, edge = 0x44dfff }) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.35, emissive: 0x031b2e }));
  body.position.y = h / 2 + 0.1;
  group.add(body);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.08, 0.08, d + 0.08), new THREE.MeshStandardMaterial({ color: 0x1a6378, emissive: 0x063649, metalness: 0.6, roughness: 0.35 }));
  roof.position.y = h + 0.15;
  group.add(roof);
  const edgeLines = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w + 0.02, h + 0.04, d + 0.02)), new THREE.LineBasicMaterial({ color: edge, transparent: true, opacity: 0.8 }));
  edgeLines.position.y = h / 2 + 0.1;
  group.add(edgeLines);
  group.position.set(x, 0, z);
  if (id) markSelectable(group, id);
  else group.userData.layer = 'infrastructure';
  scene.add(group);
  return group;
}

function buildSensor(scene, id, x, z, color = 0x53eaff) {
  const group = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.85, 8), new THREE.MeshStandardMaterial({ color: 0x9ddde8, metalness: 0.75, roughness: 0.25 }));
  pole.position.y = 0.47;
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.18, 18, 14), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.7, roughness: 0.2 }));
  orb.position.y = 0.95;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.025, 8, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.18;
  group.add(pole, orb, ring);
  group.position.set(x, 0, z);
  markSelectable(group, id);
  scene.add(group);
  return group;
}

function buildReservoir(scene, id, x, z) {
  const group = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.3, 0.6, 40, 1, false), new THREE.MeshStandardMaterial({ color: 0x1a4057, metalness: 0.65, roughness: 0.28 }));
  base.position.y = 0.46;
  const water = new THREE.Mesh(new THREE.CircleGeometry(1.13, 40), new THREE.MeshBasicMaterial({ color: 0x0bcbf4, transparent: true, opacity: 0.62, side: THREE.DoubleSide }));
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.78;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1.23, 0.06, 10, 48), new THREE.MeshBasicMaterial({ color: 0x5ceaff }));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.79;
  group.add(base, water, rim);
  group.position.set(x, 0, z);
  markSelectable(group, id);
  scene.add(group);
  return group;
}

export default function WaterScene({ selectedId, onSelect, activeLayer }) {
  const mountRef = useRef(null);
  const stateRef = useRef({});
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    const host = mountRef.current;
    if (!host) return undefined;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'low-power' });
    } catch {
      host.innerHTML = '<div class="webgl-fallback">This browser or graphics setup cannot start WebGL. Try updating your browser or graphics driver.</div>';
      return undefined;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
    const initialWidth = Math.max(1, host.clientWidth);
    const initialHeight = Math.max(1, host.clientHeight);
    renderer.setSize(initialWidth, initialHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#061523');
    scene.fog = new THREE.FogExp2('#061523', 0.017);
    const camera = new THREE.PerspectiveCamera(46, initialWidth / initialHeight, 0.1, 160);
    camera.position.set(0, 12.8, 17.5);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.minDistance = 6;
    controls.maxDistance = 34;
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.target.set(0, 0.25, 0);
    controls.update();

    scene.add(new THREE.HemisphereLight(0x73dfff, 0x101e31, 2.0));
    const keyLight = new THREE.DirectionalLight(0xbcefff, 2.6);
    keyLight.position.set(-7, 13, 8);
    keyLight.castShadow = true;
    scene.add(keyLight);
    const cyanLight = new THREE.PointLight(0x0bbdf5, 22, 28);
    cyanLight.position.set(4, 5, -4);
    scene.add(cyanLight);
    const greenLight = new THREE.PointLight(0x00d4a1, 13, 17);
    greenLight.position.set(-5, 3, 2);
    scene.add(greenLight);

    const platform = new THREE.Mesh(new THREE.BoxGeometry(23, 0.35, 14.5), new THREE.MeshStandardMaterial({ color: 0x0a2938, metalness: 0.2, roughness: 0.8 }));
    platform.position.y = -0.24;
    platform.receiveShadow = true;
    scene.add(platform);
    const platformEdge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(23, 0.35, 14.5)), new THREE.LineBasicMaterial({ color: 0x1688aa, transparent: true, opacity: 0.8 }));
    platformEdge.position.copy(platform.position);
    scene.add(platformEdge);
    const grid = new THREE.GridHelper(23, 46, 0x1285a8, 0x0b4058);
    grid.position.y = -0.045;
    grid.material.transparent = true;
    grid.material.opacity = 0.36;
    scene.add(grid);

    // Low-poly terrain islands, intentionally schematic rather than real geography.
    const terrainMat = new THREE.MeshStandardMaterial({ color: 0x123e42, roughness: 0.96, metalness: 0.02, emissive: 0x031d20 });
    const landSpecs = [
      [-8.0, -3.1, 4.1, 3.2], [-6.1, 1.7, 4.8, 3.0], [-1.4, -4.5, 4.3, 1.6],
      [1.0, 4.5, 5.0, 1.3], [6.7, 0.2, 3.8, 3.0], [8.7, 4.0, 2.0, 1.4], [-8.5, 4.4, 2.0, 1.2]
    ];
    landSpecs.forEach(([x, z, sx, sz], i) => {
      const geo = new THREE.CircleGeometry(1, 8 + (i % 3));
      const mesh = new THREE.Mesh(geo, terrainMat.clone());
      mesh.rotation.x = -Math.PI / 2;
      mesh.scale.set(sx, sz, 1);
      mesh.position.set(x, 0.015 + (i % 2) * 0.012, z);
      scene.add(mesh);
    });
    // Small terrain mounds.
    [[-8,-4,0.7],[7,-4,0.6],[-5,4,0.45],[8,2.9,0.6]].forEach(([x,z,s]) => {
      const hill = new THREE.Mesh(new THREE.ConeGeometry(s, s * 1.5, 7), new THREE.MeshStandardMaterial({ color: 0x17675e, roughness: 1 }));
      hill.position.set(x, s * 0.55, z);
      hill.rotation.y = 0.35;
      scene.add(hill);
    });

    const waterMat = new THREE.MeshStandardMaterial({ color: 0x079cce, emissive: 0x034d78, emissiveIntensity: 0.8, transparent: true, opacity: 0.82, roughness: 0.22, metalness: 0.24, side: THREE.DoubleSide });
    const riverPoints = [
      new THREE.Vector3(-11, 0.14, -2.8), new THREE.Vector3(-8, 0.15, -2.1), new THREE.Vector3(-6, 0.15, -0.9),
      new THREE.Vector3(-3.5, 0.15, -0.1), new THREE.Vector3(-1.0, 0.15, 0.1), new THREE.Vector3(1.0, 0.15, 0.85),
      new THREE.Vector3(3.5, 0.15, 1.3), new THREE.Vector3(5.9, 0.15, 0.65), new THREE.Vector3(8, 0.15, -0.45), new THREE.Vector3(11, 0.15, 0.15)
    ];
    const river = makeRibbon(riverPoints, 1.45, waterMat);
    river.userData.selectionId = 'river';
    river.userData.layer = 'context';
    scene.add(river);
    const riverEdgeMaterial = new THREE.LineBasicMaterial({ color: 0x50e8ff, transparent: true, opacity: 0.78 });
    const edgePts = new THREE.CatmullRomCurve3(riverPoints).getPoints(80);
    const edgeGeo = new THREE.BufferGeometry().setFromPoints(edgePts.map(p => new THREE.Vector3(p.x, p.y + 0.03, p.z)));
    const riverEdge = new THREE.Line(edgeGeo, riverEdgeMaterial);
    riverEdge.userData.layer = 'context';
    scene.add(riverEdge);

    // Water body glints and ripples.
    for (let i = 0; i < 17; i += 1) {
      const x = -8 + i * 0.92;
      const z = -1.75 + Math.sin(i * 0.48) * 1.15;
      const ripple = new THREE.Mesh(new THREE.BoxGeometry(0.32 + (i % 3) * 0.08, 0.015, 0.035), new THREE.MeshBasicMaterial({ color: 0x96f6ff, transparent: true, opacity: 0.26 + (i % 2) * 0.15 }));
      ripple.position.set(x, 0.185, z);
      ripple.rotation.y = -0.18;
      scene.add(ripple);
    }

    // Tiny roads and pipe runs help the map read as infrastructure.
    const roadMat = new THREE.MeshStandardMaterial({ color: 0x203847, roughness: 0.95 });
    [[-5.5,-3.0,6.2,0.16,0.42],[3.7,3.5,5.7,0.16,0.42],[2.5,-3.0,3.4,0.16,0.42]].forEach(([x,z,len,h,w]) => {
      const road = new THREE.Mesh(new THREE.BoxGeometry(len,h,w), roadMat);
      road.position.set(x, 0.04, z);
      road.rotation.y = 0.05;
      scene.add(road);
    });

    // Selectable sites.
    const source = buildBuilding(scene, { x: 2.7, z: -3.15, w: 2.5, h: 1.35, d: 1.75, color: 0x314352, id: 'source', edge: 0xffb35c });
    // Factory stacks and small tanks.
    for (let i = 0; i < 3; i += 1) {
      const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 1.35 + i * 0.18, 12), new THREE.MeshStandardMaterial({ color: 0x6b8290, metalness: 0.6, roughness: 0.4, emissive: 0x0c1a25 }));
      stack.position.set(-0.62 + i * 0.48, 1.0 + i * 0.09, -0.47);
      source.add(stack);
    }
    markSelectable(source, 'source');
    [
      { x: -4.0, z: 2.0, w: 1.15, h: 0.65, d: 0.85 },
      { x: -6.2, z: -3.8, w: 1.2, h: 0.9, d: 0.8 },
      { x: 7.0, z: 4.25, w: 1.3, h: 0.72, d: 1.0 }
    ].forEach(spec => buildBuilding(scene, spec));

    const plant = buildBuilding(scene, { x: 6.0, z: 2.7, w: 2.0, h: 0.92, d: 1.7, color: 0x164c57, id: 'plant', edge: 0x60f0c3 });
    // Treatment tanks visible from the isometric view.
    [-0.68, 0, 0.68].forEach((dx, i) => {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.34, 0.72, 20), new THREE.MeshStandardMaterial({ color: 0x317c8d, metalness: 0.52, roughness: 0.35, emissive: 0x062b3a }));
      tank.position.set(dx, 0.62, 0.85);
      plant.add(tank);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.025, 6, 24), new THREE.MeshBasicMaterial({ color: 0x59f4d0 }));
      ring.rotation.x = Math.PI / 2;
      ring.position.set(dx, 1.0, 0.85);
      plant.add(ring);
    });
    markSelectable(plant, 'plant');

    const reservoir = buildReservoir(scene, 'reservoir', 5.3, -2.7);
    const sensor = buildSensor(scene, 'sensor', -0.9, -2.7);
    const sensor2 = buildSensor(scene, 'sensor', -7.1, -0.95, 0x59ffc1);
    const sensor3 = buildSensor(scene, 'sensor', 8.6, -0.35, 0x59ffc1);
    const hotspot = new THREE.Group();
    const hotCore = new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 16), new THREE.MeshStandardMaterial({ color: 0xff3b50, emissive: 0x9f1021, emissiveIntensity: 1.8, transparent: true, opacity: 0.85 }));
    hotCore.position.y = 0.54;
    const hotRing = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.045, 10, 50), new THREE.MeshBasicMaterial({ color: 0xff5d67, transparent: true, opacity: 0.95 }));
    hotRing.rotation.x = Math.PI / 2;
    hotRing.position.y = 0.18;
    const hotRing2 = new THREE.Mesh(new THREE.TorusGeometry(0.92, 0.018, 8, 50), new THREE.MeshBasicMaterial({ color: 0xff9aa4, transparent: true, opacity: 0.62 }));
    hotRing2.rotation.x = Math.PI / 2;
    hotRing2.position.y = 0.14;
    hotspot.add(hotCore, hotRing, hotRing2);
    hotspot.position.set(1.8, 0, 1.1);
    markSelectable(hotspot, 'hotspot');
    scene.add(hotspot);
    const hotspotLabel = makeLabelSprite('POSSIBLE ALERT ZONE', '#ff8894');
    hotspotLabel.position.set(1.8, 1.65, 1.1);
    hotspotLabel.userData.selectionId = 'hotspot';
    hotspotLabel.userData.layer = 'alert zones';
    scene.add(hotspotLabel);

    // Labels float above key objects; clicks on them select the same object.
    const labels = [
      ['RIVER REACH A', -3.6, 1.0, -0.05, 'river', '#8cecff'],
      ['SENSOR 04', -0.9, 1.85, -2.7, 'sensor', '#8cecff'],
      ['NORTH RESERVOIR', 5.3, 1.55, -2.7, 'reservoir', '#8cecff'],
      ['INDUSTRIAL SITE B', 2.7, 2.15, -3.15, 'source', '#ffc477'],
      ['TREATMENT PLANT', 6.0, 1.8, 2.7, 'plant', '#75f5d0']
    ];
    labels.forEach(([txt,x,y,z,id,color]) => {
      const label = makeLabelSprite(txt, color);
      label.position.set(x,y,z);
      label.userData.selectionId = id;
      label.userData.layer = layerForId(id);
      scene.add(label);
    });

    // Trees populate the bank while keeping objects deliberately stylised.
    [ [-9,-1.5,0.9],[-8,1.8,1],[-6,2.6,0.8],[-6,-4.4,0.85],[-3,-4.7,1.1],[-2.4,3.8,0.8],[0,4.6,0.9],[4.8,4.5,0.8],[8.8,2.5,0.8],[8.1,-3.6,0.9],[5.1,-4.0,0.75],[-9,4.0,0.7] ].forEach(([x,z,s]) => buildTree(scene,x,z,s));

    // A translucent selection frame appears around the clicked 3D location.
    const focusFrame = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.7, 2.2), new THREE.MeshBasicMaterial({ color: 0x38dcff, wireframe: true, transparent: true, opacity: 0.52 }));
    focusFrame.visible = false;
    focusFrame.renderOrder = 10;
    scene.add(focusFrame);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerDown = null;
    let disposed = false;
    const target = new THREE.Vector3(0, 0.25, 0);
    const desiredCamera = new THREE.Vector3(0, 12.8, 17.5);
    let currentSelected = 'river';

    function focusOn(id, animate = true) {
      const item = siteData[id];
      if (!item) return;
      currentSelected = id;
      const pos = item.position;
      target.set(pos.x, Math.max(0.35, pos.y), pos.z);
      desiredCamera.set(pos.x + 6.1, pos.y + 7.2, pos.z + 8.1);
      if (!animate) {
        controls.target.copy(target);
        camera.position.copy(desiredCamera);
        controls.update();
      }
      focusFrame.position.set(pos.x, pos.y + 0.75, pos.z);
      focusFrame.userData.layer = layerForId(id);
      focusFrame.scale.set(id === 'river' ? 1.55 : 1, id === 'river' ? 0.7 : 1, id === 'river' ? 0.7 : 1);
      focusFrame.visible = true;
    }

    // Press R to zoom in and F to zoom out from the currently selected object.
    // Keep Ctrl/Cmd+R untouched so the browser refresh shortcut still works.
    function zoomIn() {
      const offset = desiredCamera.clone().sub(target);
      const currentDistance = offset.length();
      if (currentDistance < 0.001) return;
      const nextDistance = Math.max(controls.minDistance, currentDistance * 0.82);
      desiredCamera.copy(target).add(offset.normalize().multiplyScalar(nextDistance));
    }

    function zoomOut() {
      const offset = desiredCamera.clone().sub(target);
      const currentDistance = offset.length();
      if (currentDistance < 0.001) return;
      const nextDistance = Math.min(controls.maxDistance, currentDistance * 1.22);
      desiredCamera.copy(target).add(offset.normalize().multiplyScalar(nextDistance));
    }

    function handleKeyDown(event) {
      const key = event.key?.toLowerCase();
      if (!['r', 'f'].includes(key) || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      const activeElement = document.activeElement;
      const typing = activeElement && (
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeElement.tagName) || activeElement.isContentEditable
      );
      if (typing) return;
      event.preventDefault();
      if (key === 'r') zoomIn();
      if (key === 'f') zoomOut();
    }

    window.addEventListener('keydown', handleKeyDown);

    function handlePointerDown(event) {
      pointerDown = { x: event.clientX, y: event.clientY };
    }
    function handlePointerUp(event) {
      if (!pointerDown) return;
      const delta = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
      pointerDown = null;
      if (delta > 5) return;
      const bounds = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
      pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(scene.children, true);
      for (const hit of hits) {
        let object = hit.object;
        let id = object.userData.selectionId;
        while (!id && object.parent) {
          object = object.parent;
          id = object.userData.selectionId;
        }
        if (id && siteData[id]) {
          onSelectRef.current(id);
          focusOn(id, true);
          return;
        }
      }
    }
    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    renderer.domElement.addEventListener('pointerup', handlePointerUp);

    const resizeObserver = new ResizeObserver(() => {
      if (!host.clientWidth || !host.clientHeight) return;
      camera.aspect = host.clientWidth / host.clientHeight;
      camera.updateProjectionMatrix();
      const initialWidth = Math.max(1, host.clientWidth);
    const initialHeight = Math.max(1, host.clientHeight);
    renderer.setSize(initialWidth, initialHeight);
    });
    resizeObserver.observe(host);
    if (host.clientWidth > 0 && host.clientHeight > 0) {
      camera.aspect = host.clientWidth / host.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(host.clientWidth, host.clientHeight);
    }

    let frame = 0;
    const clock = new THREE.Clock();
    function render() {
      if (disposed) return;
      frame = requestAnimationFrame(render);
      const t = clock.getElapsedTime();
      hotspot.scale.setScalar(1 + Math.sin(t * 2.3) * 0.045);
      sensor.children[1].material.emissiveIntensity = 1.2 + (Math.sin(t * 2.5) + 1) * 0.55;
      hotRing.rotation.z = t * 0.17;
      hotRing2.rotation.z = -t * 0.12;
      controls.target.lerp(target, 0.045);
      camera.position.lerp(desiredCamera, 0.035);
      controls.update();
      renderer.render(scene, camera);
    }
    render();
    focusOn(selectedId || 'river', false);

    function setLayer(layerName) {
      const visibleLayers = {
        'All layers': ['context', 'water quality', 'infrastructure', 'alert zones'],
        'Water quality': ['context', 'water quality', 'alert zones'],
        'Infrastructure': ['context', 'infrastructure'],
        'Alert zones': ['context', 'alert zones', 'water quality']
      }[layerName] || ['context', 'water quality', 'infrastructure', 'alert zones'];
      scene.traverse((object) => {
        const layer = object.userData?.layer;
        if (layer) object.visible = visibleLayers.includes(layer);
      });
    }
    stateRef.current = { focusOn, setLayer, zoomIn, zoomOut };
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderer.domElement.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('keydown', handleKeyDown);
      controls.dispose();
      scene.traverse((object) => {
        if (object.geometry) object.geometry.dispose();
        if (object.material) {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((m) => {
            if (m.map) m.map.dispose();
            m.dispose();
          });
        }
      });
      renderer.dispose();
      if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
    };
  }, []);

  useEffect(() => {
    stateRef.current.focusOn?.(selectedId, true);
  }, [selectedId]);

  useEffect(() => {
    stateRef.current.setLayer?.(activeLayer);
  }, [activeLayer]);

  return <div className="water-scene" ref={mountRef} aria-label="Interactive 3D water catchment. Click objects to inspect them." />;
}
