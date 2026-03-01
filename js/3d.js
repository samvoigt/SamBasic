// SamBasic 3D Wireframe Engine
// Retained-mode scene with perspective projection onto 2D canvas.

class Scene3D {
  constructor() {
    this.objects = {};
    this.nextId = 1;
    // Default camera: eye at (0, 0, 10), looking at origin
    this.eye = [0, 0, 10];
    this.target = [0, 0, 0];
    this.up = [0, 1, 0];
    // Perspective settings
    this.fov = 60; // degrees
    this.near = 0.1;
    this.far = 1000;
    this.width = 640;
    this.height = 480;
  }

  clear() {
    this.objects = {};
    this.nextId = 1;
    this.eye = [0, 0, 10];
    this.target = [0, 0, 0];
  }

  createObject(shapeType, params, color) {
    const id = this.nextId++;
    const mesh = Scene3D.generateMesh(shapeType, params);
    this.objects[id] = {
      id,
      mesh,
      shapeType,
      color: color || '#00ff00',
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: 1,
      visible: true,
      hiddenEdges: false,
      parent: null,
      children: [],
    };
    return id;
  }

  createGroup() {
    const id = this.nextId++;
    this.objects[id] = {
      id,
      mesh: null,
      shapeType: 'GROUP',
      color: null,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: 1,
      visible: true,
      hiddenEdges: false,
      parent: null,
      children: [],
    };
    return id;
  }

  attach(parentId, childId) {
    const parent = this.getObject(parentId);
    const child = this.getObject(childId);
    if (parent.shapeType !== 'GROUP') {
      throw new Error(`ATTACH3D: object ${parentId} is not a group`);
    }
    // Prevent cycles: walk up from parent to make sure child isn't an ancestor
    let node = parent;
    while (node.parent !== null) {
      if (node.parent === childId) {
        throw new Error(`ATTACH3D: cannot attach object ${childId} to ${parentId} — would create a cycle`);
      }
      node = this.objects[node.parent];
    }
    // Detach from previous parent if any
    if (child.parent !== null) {
      const oldParent = this.objects[child.parent];
      if (oldParent) {
        oldParent.children = oldParent.children.filter(cid => cid !== childId);
      }
    }
    child.parent = parentId;
    if (!parent.children.includes(childId)) {
      parent.children.push(childId);
    }
  }

  detach(childId) {
    const child = this.getObject(childId);
    if (child.parent === null) return;
    const parent = this.objects[child.parent];
    if (parent) {
      parent.children = parent.children.filter(cid => cid !== childId);
    }
    child.parent = null;
  }

  deleteObject(id) {
    const obj = this.objects[id];
    if (!obj) throw new Error(`DELETE3D: object ${id} not found`);
    // Recursively delete children
    for (const childId of [...obj.children]) {
      this.deleteObject(childId);
    }
    // Detach from parent
    if (obj.parent !== null) {
      const parent = this.objects[obj.parent];
      if (parent) {
        parent.children = parent.children.filter(cid => cid !== id);
      }
    }
    delete this.objects[id];
  }

  getObject(id) {
    const obj = this.objects[id];
    if (!obj) throw new Error(`3D object ${id} not found`);
    return obj;
  }

  // --- Rendering ---

  render(drawLine, drawPixel) {
    const view = Scene3D.lookAt(this.eye, this.target, this.up);
    const aspect = this.width / this.height;
    const proj = Scene3D.perspective(this.fov, aspect, this.near, this.far);
    const vp = Scene3D.mat4Mul(proj, view);
    const hw = this.width / 2;
    const hh = this.height / 2;

    // Collect renderable primitives by walking the scene graph depth-first
    const renderList = [];
    const identity = Scene3D.mat4Identity();

    // Only start from root objects (no parent)
    for (const id in this.objects) {
      const obj = this.objects[id];
      if (obj.parent === null) {
        this._collectRenderables(obj, identity, view, vp, hw, hh, renderList);
      }
    }

    // Depth sort back-to-front
    renderList.sort((a, b) => b.dist - a.dist);

    // Draw
    for (const { obj, mvp, model } of renderList) {
      const mesh = obj.mesh;

      if (obj.shapeType === 'POINT') {
        const v = mesh.vertices[0];
        const p = this._projectVertex(mvp, v, hw, hh);
        if (p) {
          const s = mesh.pointSize || 2;
          drawLine(p[0] - s, p[1], p[0] + s, p[1], obj.color);
          drawLine(p[0], p[1] - s, p[0], p[1] + s, obj.color);
        }
        continue;
      }

      const projected = mesh.vertices.map(v => this._projectVertex(mvp, v, hw, hh));

      if (obj.hiddenEdges && mesh.faces) {
        const visibleEdges = new Set();
        const modelView = Scene3D.mat4Mul(view, model);
        for (const face of mesh.faces) {
          const vs = face.map(i => Scene3D.mat4MulVec(modelView, [...mesh.vertices[i], 1]));
          const e1 = [vs[1][0] - vs[0][0], vs[1][1] - vs[0][1], vs[1][2] - vs[0][2]];
          const e2 = [vs[2][0] - vs[0][0], vs[2][1] - vs[0][1], vs[2][2] - vs[0][2]];
          const nz = e1[0] * e2[1] - e1[1] * e2[0];
          if (nz > 0) {
            for (let j = 0; j < face.length; j++) {
              const a = face[j];
              const b = face[(j + 1) % face.length];
              visibleEdges.add(a < b ? `${a}_${b}` : `${b}_${a}`);
            }
          }
        }
        for (const [a, b] of mesh.edges) {
          const key = a < b ? `${a}_${b}` : `${b}_${a}`;
          if (!visibleEdges.has(key)) continue;
          const pa = projected[a];
          const pb = projected[b];
          if (pa && pb) drawLine(pa[0], pa[1], pb[0], pb[1], obj.color);
        }
      } else {
        for (const [a, b] of mesh.edges) {
          const pa = projected[a];
          const pb = projected[b];
          if (pa && pb) drawLine(pa[0], pa[1], pb[0], pb[1], obj.color);
        }
      }
    }
  }

  _collectRenderables(obj, parentModel, view, vp, hw, hh, renderList) {
    if (!obj.visible) return;

    const localModel = Scene3D.buildModelMatrix(obj.position, obj.rotation, obj.scale);
    const worldModel = Scene3D.mat4Mul(parentModel, localModel);

    // If this is a primitive (has mesh), add to render list
    if (obj.mesh) {
      const mvp = Scene3D.mat4Mul(vp, worldModel);
      const center = Scene3D.mat4MulVec(worldModel, [0, 0, 0, 1]);
      const dx = center[0] - this.eye[0];
      const dy = center[1] - this.eye[1];
      const dz = center[2] - this.eye[2];
      const dist = dx * dx + dy * dy + dz * dz;
      renderList.push({ obj, mvp, model: worldModel, dist });
    }

    // Recurse into children
    for (const childId of obj.children) {
      const child = this.objects[childId];
      if (child) this._collectRenderables(child, worldModel, view, vp, hw, hh, renderList);
    }
  }

  _projectVertex(mvp, vertex, hw, hh) {
    const v = Scene3D.mat4MulVec(mvp, [vertex[0], vertex[1], vertex[2], 1]);
    // Clip against near plane
    if (v[3] <= 0) return null;
    const invW = 1 / v[3];
    const x = v[0] * invW;
    const y = v[1] * invW;
    const z = v[2] * invW;
    // Clip to NDC cube [-1, 1]
    if (z < -1 || z > 1) return null;
    // Convert to screen coordinates (Y is flipped: NDC +Y is up, screen +Y is down)
    const sx = Math.round(hw + x * hw);
    const sy = Math.round(hh - y * hh);
    return [sx, sy];
  }

  // --- Matrix Math ---

  static mat4Identity() {
    return [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ];
  }

  static mat4Mul(a, b) {
    const r = new Array(16).fill(0);
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) {
          sum += a[row * 4 + k] * b[k * 4 + col];
        }
        r[row * 4 + col] = sum;
      }
    }
    return r;
  }

  static mat4MulVec(m, v) {
    return [
      m[0] * v[0] + m[1] * v[1] + m[2] * v[2] + m[3] * v[3],
      m[4] * v[0] + m[5] * v[1] + m[6] * v[2] + m[7] * v[3],
      m[8] * v[0] + m[9] * v[1] + m[10] * v[2] + m[11] * v[3],
      m[12] * v[0] + m[13] * v[1] + m[14] * v[2] + m[15] * v[3],
    ];
  }

  static translationMatrix(x, y, z) {
    return [
      1, 0, 0, x,
      0, 1, 0, y,
      0, 0, 1, z,
      0, 0, 0, 1,
    ];
  }

  static scaleMatrix(s) {
    return [
      s, 0, 0, 0,
      0, s, 0, 0,
      0, 0, s, 0,
      0, 0, 0, 1,
    ];
  }

  static rotationX(deg) {
    const r = deg * Math.PI / 180;
    const c = Math.cos(r), s = Math.sin(r);
    return [
      1, 0,  0, 0,
      0, c, -s, 0,
      0, s,  c, 0,
      0, 0,  0, 1,
    ];
  }

  static rotationY(deg) {
    const r = deg * Math.PI / 180;
    const c = Math.cos(r), s = Math.sin(r);
    return [
       c, 0, s, 0,
       0, 1, 0, 0,
      -s, 0, c, 0,
       0, 0, 0, 1,
    ];
  }

  static rotationZ(deg) {
    const r = deg * Math.PI / 180;
    const c = Math.cos(r), s = Math.sin(r);
    return [
      c, -s, 0, 0,
      s,  c, 0, 0,
      0,  0, 1, 0,
      0,  0, 0, 1,
    ];
  }

  static buildModelMatrix(position, rotation, scale) {
    // Scale → RotateX → RotateY → RotateZ → Translate
    let m = Scene3D.scaleMatrix(scale);
    m = Scene3D.mat4Mul(Scene3D.rotationX(rotation[0]), m);
    m = Scene3D.mat4Mul(Scene3D.rotationY(rotation[1]), m);
    m = Scene3D.mat4Mul(Scene3D.rotationZ(rotation[2]), m);
    m = Scene3D.mat4Mul(Scene3D.translationMatrix(position[0], position[1], position[2]), m);
    return m;
  }

  static lookAt(eye, target, up) {
    const zAxis = Scene3D.vecNormalize([
      eye[0] - target[0], eye[1] - target[1], eye[2] - target[2],
    ]);
    const xAxis = Scene3D.vecNormalize(Scene3D.vecCross(up, zAxis));
    const yAxis = Scene3D.vecCross(zAxis, xAxis);
    return [
      xAxis[0], xAxis[1], xAxis[2], -Scene3D.vecDot(xAxis, eye),
      yAxis[0], yAxis[1], yAxis[2], -Scene3D.vecDot(yAxis, eye),
      zAxis[0], zAxis[1], zAxis[2], -Scene3D.vecDot(zAxis, eye),
      0, 0, 0, 1,
    ];
  }

  static perspective(fovDeg, aspect, near, far) {
    const f = 1 / Math.tan((fovDeg * Math.PI / 180) / 2);
    const rangeInv = 1 / (near - far);
    return [
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (near + far) * rangeInv, 2 * near * far * rangeInv,
      0, 0, -1, 0,
    ];
  }

  // --- Vector helpers ---

  static vecDot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

  static vecCross(a, b) {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
  }

  static vecNormalize(v) {
    const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    if (len < 1e-10) return [0, 0, 0];
    return [v[0] / len, v[1] / len, v[2] / len];
  }

  // --- Shape Generators ---
  // Each returns { vertices: [[x,y,z], ...], edges: [[i,j], ...], faces?: [[i,j,k,...], ...] }
  // Faces are used for back-face culling. Winding order is CCW when viewed from outside.

  static generateMesh(shapeType, params) {
    switch (shapeType) {
      case 'CUBE': return Scene3D.genCube(params.size || 1);
      case 'SPHERE': return Scene3D.genSphere(params.radius || 1, params.segments || 12);
      case 'CONE': return Scene3D.genCone(params.radius || 1, params.height || 2, params.segments || 8);
      case 'CYLINDER': return Scene3D.genCylinder(params.radius || 1, params.height || 2, params.segments || 8);
      case 'PYRAMID': return Scene3D.genPyramid(params.base || 1, params.height || 2);
      case 'PLANE': return Scene3D.genPlane(params.width || 1, params.depth || 1, params.divisions || 1);
      case 'TORUS': return Scene3D.genTorus(params.radius || 2, params.tube || 0.5, params.segments || 16, params.tubeSegments || 8);
      case 'LINE': return Scene3D.genLine(params.x1||0, params.y1||0, params.z1||0, params.x2||0, params.y2||0, params.z2||0);
      case 'POINT': return Scene3D.genPoint(params.size || 2);
      case 'PATH': return Scene3D.genPath(params.points || []);
      default: throw new Error(`Unknown 3D shape: ${shapeType}`);
    }
  }

  static genCube(size) {
    const s = size / 2;
    const vertices = [
      [-s, -s, -s], [ s, -s, -s], [ s,  s, -s], [-s,  s, -s], // back face
      [-s, -s,  s], [ s, -s,  s], [ s,  s,  s], [-s,  s,  s], // front face
    ];
    const edges = [
      // back
      [0, 1], [1, 2], [2, 3], [3, 0],
      // front
      [4, 5], [5, 6], [6, 7], [7, 4],
      // connecting
      [0, 4], [1, 5], [2, 6], [3, 7],
    ];
    // CCW faces when viewed from outside
    const faces = [
      [0, 3, 2, 1], // back (-Z)
      [4, 5, 6, 7], // front (+Z)
      [0, 1, 5, 4], // bottom (-Y)
      [2, 3, 7, 6], // top (+Y)
      [0, 4, 7, 3], // left (-X)
      [1, 2, 6, 5], // right (+X)
    ];
    return { vertices, edges, faces };
  }

  static genSphere(radius, segments) {
    const vertices = [];
    const edges = [];
    const faces = [];
    const rings = segments;
    const slices = segments;

    // Generate vertices: poles + rings
    for (let ring = 0; ring <= rings; ring++) {
      const phi = Math.PI * ring / rings;
      for (let slice = 0; slice < slices; slice++) {
        const theta = 2 * Math.PI * slice / slices;
        vertices.push([
          radius * Math.sin(phi) * Math.cos(theta),
          radius * Math.cos(phi),
          radius * Math.sin(phi) * Math.sin(theta),
        ]);
      }
    }

    // Edges and faces
    for (let ring = 0; ring < rings; ring++) {
      for (let slice = 0; slice < slices; slice++) {
        const curr = ring * slices + slice;
        const next = ring * slices + (slice + 1) % slices;
        const below = (ring + 1) * slices + slice;
        const belowNext = (ring + 1) * slices + (slice + 1) % slices;

        // Horizontal edge (along ring)
        edges.push([curr, next]);
        // Vertical edge (between rings)
        edges.push([curr, below]);
        // Face (quad)
        faces.push([curr, next, belowNext, below]);
      }
    }

    return { vertices, edges, faces };
  }

  static genCone(radius, height, segments) {
    const vertices = [];
    const edges = [];
    const faces = [];

    // Base circle vertices
    for (let i = 0; i < segments; i++) {
      const theta = 2 * Math.PI * i / segments;
      vertices.push([radius * Math.cos(theta), 0, radius * Math.sin(theta)]);
    }
    // Apex
    const apexIdx = segments;
    vertices.push([0, height, 0]);
    // Base center (for base face)
    const baseCenterIdx = segments + 1;
    vertices.push([0, 0, 0]);

    // Base edges and side edges
    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments;
      edges.push([i, next]); // base ring
      edges.push([i, apexIdx]); // to apex
      // Side faces (triangle: apex, current, next) — CCW from outside
      faces.push([apexIdx, next, i]);
    }
    // Base face (CCW when viewed from below, i.e., -Y direction)
    const baseFace = [];
    for (let i = 0; i < segments; i++) baseFace.push(i);
    faces.push(baseFace);

    return { vertices, edges, faces };
  }

  static genCylinder(radius, height, segments) {
    const vertices = [];
    const edges = [];
    const faces = [];

    // Bottom circle
    for (let i = 0; i < segments; i++) {
      const theta = 2 * Math.PI * i / segments;
      vertices.push([radius * Math.cos(theta), 0, radius * Math.sin(theta)]);
    }
    // Top circle
    for (let i = 0; i < segments; i++) {
      const theta = 2 * Math.PI * i / segments;
      vertices.push([radius * Math.cos(theta), height, radius * Math.sin(theta)]);
    }

    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments;
      const topI = segments + i;
      const topNext = segments + next;
      edges.push([i, next]);         // bottom ring
      edges.push([topI, topNext]);   // top ring
      edges.push([i, topI]);         // vertical
      // Side face (quad, CCW from outside)
      faces.push([i, next, topNext, topI]);
    }
    // Bottom face (CCW from below)
    const bottomFace = [];
    for (let i = 0; i < segments; i++) bottomFace.push(i);
    faces.push(bottomFace);
    // Top face (CCW from above)
    const topFace = [];
    for (let i = segments - 1; i >= 0; i--) topFace.push(segments + i);
    faces.push(topFace);

    return { vertices, edges, faces };
  }

  static genPyramid(base, height) {
    const s = base / 2;
    const vertices = [
      [-s, 0, -s], [ s, 0, -s], [ s, 0,  s], [-s, 0,  s], // base
      [ 0, height, 0], // apex
    ];
    const edges = [
      [0, 1], [1, 2], [2, 3], [3, 0], // base
      [0, 4], [1, 4], [2, 4], [3, 4], // to apex
    ];
    // CCW faces from outside
    const faces = [
      [0, 1, 2, 3], // bottom (CCW from below)
      [4, 1, 0],     // back
      [4, 2, 1],     // right
      [4, 3, 2],     // front
      [4, 0, 3],     // left
    ];
    return { vertices, edges, faces };
  }

  static genPlane(width, depth, divisions) {
    const vertices = [];
    const edges = [];
    const hw = width / 2;
    const hd = depth / 2;

    // Grid of vertices on XZ plane at Y=0
    for (let zi = 0; zi <= divisions; zi++) {
      for (let xi = 0; xi <= divisions; xi++) {
        const x = -hw + (xi / divisions) * width;
        const z = -hd + (zi / divisions) * depth;
        vertices.push([x, 0, z]);
      }
    }
    const cols = divisions + 1;
    for (let zi = 0; zi <= divisions; zi++) {
      for (let xi = 0; xi <= divisions; xi++) {
        const idx = zi * cols + xi;
        if (xi < divisions) edges.push([idx, idx + 1]); // horizontal
        if (zi < divisions) edges.push([idx, idx + cols]); // vertical
      }
    }
    // No faces — plane is not a closed solid, no back-face culling
    return { vertices, edges };
  }

  static genTorus(radius, tube, segments, tubeSegments) {
    const vertices = [];
    const edges = [];
    const faces = [];

    for (let i = 0; i < segments; i++) {
      const theta = 2 * Math.PI * i / segments;
      const ct = Math.cos(theta), st = Math.sin(theta);
      for (let j = 0; j < tubeSegments; j++) {
        const phi = 2 * Math.PI * j / tubeSegments;
        const cp = Math.cos(phi), sp = Math.sin(phi);
        const x = (radius + tube * cp) * ct;
        const y = tube * sp;
        const z = (radius + tube * cp) * st;
        vertices.push([x, y, z]);
      }
    }

    for (let i = 0; i < segments; i++) {
      const nextI = (i + 1) % segments;
      for (let j = 0; j < tubeSegments; j++) {
        const nextJ = (j + 1) % tubeSegments;
        const curr = i * tubeSegments + j;
        const currNext = i * tubeSegments + nextJ;
        const nextCurr = nextI * tubeSegments + j;
        const nextNext = nextI * tubeSegments + nextJ;
        // Ring edge
        edges.push([curr, currNext]);
        // Segment edge
        edges.push([curr, nextCurr]);
        // Face (quad, CCW from outside)
        faces.push([curr, nextCurr, nextNext, currNext]);
      }
    }

    return { vertices, edges, faces };
  }

  static genLine(x1, y1, z1, x2, y2, z2) {
    return {
      vertices: [[x1, y1, z1], [x2, y2, z2]],
      edges: [[0, 1]],
    };
  }

  static genPoint(size) {
    return {
      vertices: [[0, 0, 0]],
      edges: [],
      pointSize: size,
    };
  }

  static genPath(points) {
    const vertices = points.map(p => [p[0], p[1], p[2]]);
    const edges = [];
    for (let i = 0; i < vertices.length - 1; i++) {
      edges.push([i, i + 1]);
    }
    return { vertices, edges };
  }
}
