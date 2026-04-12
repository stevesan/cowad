import { maps } from '../state/appState';
import { createCloneContext, type MapContext } from '../map/mapContext';
import { fixSectors } from '../map/drawSession';
import { segmentIntersectionPoint, pointInPoly } from '../geometry/hitTest';
import { findExistingLinedef } from '../geometry/sectorQueries';
import type { HalfSector } from '../types';

const EPSILON = 0.5;

function findVertexAt(ctx: MapContext, x: number, y: number): string | null {
  for (const [vid, v] of ctx.vertices) {
    if (Math.abs(v.x - x) < EPSILON && Math.abs(v.y - y) < EPSILON) return vid;
  }
  return null;
}

function splitLinedefAt(ctx: MapContext, ldId: string, midVid: string, newLds: Set<string>): string {
  const ld = ctx.linedefs.get(ldId)!;
  const origV2 = ld.v2;

  const newLd: any = { v1: midVid, v2: origV2, flags: ld.flags ?? 1, frontSide: null as string | null, backSide: null as string | null };
  if (ld.special != null) newLd.special = ld.special;
  if (ld.tag != null) newLd.tag = ld.tag;

  if (ld.frontSide) {
    const fsd = ctx.sidedefs.get(ld.frontSide);
    if (fsd) {
      const cloneSd = { ...fsd };
      newLd.frontSide = ctx.pushSidedef(cloneSd);
    }
  }
  if (ld.backSide) {
    const bsd = ctx.sidedefs.get(ld.backSide);
    if (bsd) {
      const cloneSd = { ...bsd };
      newLd.backSide = ctx.pushSidedef(cloneSd);
    }
  }

  ctx.updateLinedef(ldId, { v2: midVid });
  const newLdId = ctx.pushLinedef(newLd);
  newLds.add(newLdId);
  return newLdId;
}

export function mergeHalfSectors(): MapContext | null {
  if (maps.halfSectors.size === 0) return null;

  const ctx = createCloneContext();
  const newLds = new Set<string>();

  for (const [, hs] of maps.halfSectors) {
    if (!hs.outline || hs.outline.length < 3) continue;
    addHalfSectorGeometry(ctx, hs, newLds);
  }

  if (newLds.size === 0) return null;

  fixSectors(newLds, ctx);

  applyHalfSectorProperties(ctx);

  return ctx;
}

function addHalfSectorGeometry(ctx: MapContext, hs: HalfSector, newLds: Set<string>): void {
  const outline = hs.outline;
  const n = outline.length;

  const vertexIds: string[] = [];
  for (const pt of outline) {
    const rx = Math.round(pt.x), ry = Math.round(pt.y);
    let vid = findVertexAt(ctx, rx, ry);
    if (!vid) vid = ctx.pushVertex({ x: rx, y: ry });
    vertexIds.push(vid);
  }

  // For each edge in the outline, intersect with existing linedefs, split, then create
  for (let i = 0; i < n; i++) {
    const vaId = vertexIds[i];
    const vbId = vertexIds[(i + 1) % n];
    if (vaId === vbId) continue;

    const existing = findExistingLinedef(ctx.linedefs, vaId, vbId);
    if (existing) {
      newLds.add(existing.ldId);
      continue;
    }

    addEdgeWithIntersections(ctx, vaId, vbId, newLds);
  }
}

function addEdgeWithIntersections(ctx: MapContext, vaId: string, vbId: string, newLds: Set<string>): void {
  const va = ctx.vertices.get(vaId)!;
  const vb = ctx.vertices.get(vbId)!;

  // Collect intersections with existing linedefs
  type Hit = { x: number; y: number; t: number; ldId: string; tLD: number };
  const hits: Hit[] = [];

  for (const [ldId, ld] of ctx.linedefs) {
    if (newLds.has(ldId)) continue; // skip newly added half-sector lines
    const v1 = ctx.vertices.get(ld.v1), v2 = ctx.vertices.get(ld.v2);
    if (!v1 || !v2) continue;

    const ix = segmentIntersectionPoint(va.x, va.y, vb.x, vb.y, v1.x, v1.y, v2.x, v2.y);
    if (!ix) continue;

    // Skip if intersection is at an existing endpoint
    const atEndpoint = (Math.abs(ix.x - v1.x) < EPSILON && Math.abs(ix.y - v1.y) < EPSILON) ||
                       (Math.abs(ix.x - v2.x) < EPSILON && Math.abs(ix.y - v2.y) < EPSILON) ||
                       (Math.abs(ix.x - va.x) < EPSILON && Math.abs(ix.y - va.y) < EPSILON) ||
                       (Math.abs(ix.x - vb.x) < EPSILON && Math.abs(ix.y - vb.y) < EPSILON);
    if (atEndpoint) continue;

    hits.push({ x: ix.x, y: ix.y, t: ix.tAB, ldId, tLD: ix.tCD });
  }

  // Sort by parametric position along the new edge
  hits.sort((a, b) => a.t - b.t);

  // Deduplicate by position
  const unique: Hit[] = [];
  for (const h of hits) {
    if (unique.length && Math.abs(h.x - unique[unique.length - 1].x) < EPSILON &&
        Math.abs(h.y - unique[unique.length - 1].y) < EPSILON) continue;
    unique.push(h);
  }

  // Create vertices at intersection points and split existing linedefs
  const midVids: string[] = [];
  for (const h of unique) {
    let vid = findVertexAt(ctx, h.x, h.y);
    if (!vid) vid = ctx.pushVertex({ x: h.x, y: h.y });
    midVids.push(vid);

    // Split the existing linedef at this vertex
    const ld = ctx.linedefs.get(h.ldId);
    if (ld) {
      // Check the vertex isn't already an endpoint of this linedef
      if (ld.v1 !== vid && ld.v2 !== vid) {
        splitLinedefAt(ctx, h.ldId, vid, newLds);
      }
    }
  }

  // Now create the chain of linedefs for the new edge: va -> mid1 -> mid2 -> ... -> vb
  const chain = [vaId, ...midVids, vbId];
  for (let j = 0; j < chain.length - 1; j++) {
    const a = chain[j], b = chain[j + 1];
    if (a === b) continue;
    const ex = findExistingLinedef(ctx.linedefs, a, b);
    if (ex) {
      newLds.add(ex.ldId);
    } else {
      const ldId = ctx.pushLinedef({ v1: a, v2: b, flags: 1, frontSide: null, backSide: null });
      newLds.add(ldId);
    }
  }
}

function applyHalfSectorProperties(ctx: MapContext): void {
  for (const [, hs] of maps.halfSectors) {
    if (!hs.outline || hs.outline.length < 3) continue;

    // Compute centroid of the half-sector
    let cx = 0, cy = 0;
    for (const pt of hs.outline) { cx += pt.x; cy += pt.y; }
    cx /= hs.outline.length;
    cy /= hs.outline.length;

    // Find which sector in the clone contains this centroid
    for (const [secId, sec] of ctx.sectors) {
      const poly = buildSectorPoly(ctx, secId);
      if (!poly || poly.length < 3) continue;
      if (!pointInPoly(cx, cy, poly)) continue;

      if (hs.type === 'floor') {
        if (hs.height != null) sec.floor = hs.height;
        if (hs.tex) sec.floorTex = hs.tex;
        if (hs.light != null) sec.light = hs.light;
      } else {
        if (hs.height != null) sec.ceiling = hs.height;
        if (hs.tex) sec.ceilTex = hs.tex;
        if (hs.light != null) sec.light = hs.light;
      }
      break;
    }
  }
}

function buildSectorPoly(ctx: MapContext, secId: string): { x: number; y: number }[] | null {
  // Find all linedefs whose front sidedef references this sector
  // and trace the boundary
  const boundary: { x: number; y: number }[] = [];
  const edgeVids: [string, string][] = [];

  for (const [, ld] of ctx.linedefs) {
    if (ld.frontSide) {
      const sd = ctx.sidedefs.get(ld.frontSide);
      if (sd?.sector === secId) edgeVids.push([ld.v1, ld.v2]);
    }
    if (ld.backSide) {
      const sd = ctx.sidedefs.get(ld.backSide);
      if (sd?.sector === secId) edgeVids.push([ld.v2, ld.v1]);
    }
  }

  if (edgeVids.length === 0) return null;

  // Simple chain following from the first edge
  const adj = new Map<string, string>();
  for (const [a, b] of edgeVids) adj.set(a, b);

  let cur = edgeVids[0][0];
  const start = cur;
  for (let i = 0; i < edgeVids.length + 1; i++) {
    const v = ctx.vertices.get(cur);
    if (!v) break;
    boundary.push({ x: v.x, y: v.y });
    const next = adj.get(cur);
    if (!next || next === start) break;
    cur = next;
  }

  return boundary.length >= 3 ? boundary : null;
}
