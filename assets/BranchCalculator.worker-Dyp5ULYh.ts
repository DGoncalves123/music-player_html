/**
 * Web Worker for calculating branch connections
 * Runs off the main thread to avoid blocking UI
 */

import type { Corner, BranchConnection } from './types';

interface CalculationMessage {
  corners: Corner[];
  canvasWidth: number;
  canvasHeight: number;
  maxBranchDistance: number;
  tolerance: number;
}

interface CalculationResult {
  branches: BranchConnection[];
}

// Listen for messages from the main thread
self.addEventListener('message', (event: MessageEvent<CalculationMessage>) => {
  const { corners, canvasWidth, canvasHeight, maxBranchDistance, tolerance } = event.data;
  
  const branches = calculateBranches(corners, canvasWidth, canvasHeight, maxBranchDistance, tolerance);
  
  // Send result back to main thread
  const result: CalculationResult = { branches };
  self.postMessage(result);
});

function calculateBranches(
  corners: Corner[],
  screenWidth: number,
  screenHeight: number,
  maxBranchDistance: number,
  tolerance: number
): BranchConnection[] {
  const newBranches: BranchConnection[] = [];

  // Track which corners have incoming connections from which directions
  const blockedDirections = new Map<string, Set<string>>();
  
  const getCornerKey = (corner: Corner) => `${corner.elementId}-${corner.position}`;
  
  const getOppositeDir = (dir: string): string => {
    if (dir === 'left') return 'right';
    if (dir === 'right') return 'left';
    if (dir === 'up') return 'down';
    if (dir === 'down') return 'up';
    return dir;
  };

  // Define which directions each corner type shoots (all 4 directions)
  const cornerDirections: Record<string, string[]> = {
    'top-left': ['left', 'right', 'up', 'down'],
    'top-right': ['left', 'right', 'up', 'down'],
    'bottom-left': ['left', 'right', 'up', 'down'],
    'bottom-right': ['left', 'right', 'up', 'down'],
  };

  for (const from of corners) {
    const fromKey = getCornerKey(from);
    const directions = cornerDirections[from.position] || [];
    const blocked = blockedDirections.get(fromKey) || new Set<string>();

    for (const dir of directions) {
      // Skip if this direction is blocked by an incoming connection
      if (blocked.has(dir)) continue;
      
      let nearestCorner: Corner | null = null;
      let nearestDistance = Infinity;

      // Check all other corners to find one in this direction's path
      for (const to of corners) {
        if (from.elementId === to.elementId && from.position === to.position) continue;

        // Check if the target corner's opposite direction is already blocked
        const oppositeDir = getOppositeDir(dir);
        const toKey = getCornerKey(to);
        const toBlocked = blockedDirections.get(toKey) || new Set<string>();
        if (toBlocked.has(oppositeDir)) {
          // This corner already has an incoming connection from this direction
          continue;
        }

        const dx = to.x - from.x;
        const dy = to.y - from.y;
        let inPath = false;

        // For corners from the same element, use relaxed tolerance
        const isSameElement = from.elementId === to.elementId;
        const currentTolerance = isSameElement ? Infinity : tolerance;

        // Simple coordinate check: is target corner in the path?
        if (dir === 'left' && dx < 0 && Math.abs(dy) < currentTolerance) {
          inPath = true;
        } else if (dir === 'right' && dx > 0 && Math.abs(dy) < currentTolerance) {
          inPath = true;
        } else if (dir === 'up' && dy < 0 && Math.abs(dx) < currentTolerance) {
          inPath = true;
        } else if (dir === 'down' && dy > 0 && Math.abs(dx) < currentTolerance) {
          inPath = true;
        }

        if (inPath) {
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestCorner = to;
          }
        }
      }

      // Determine endpoint: nearest corner or screen edge
      let endpoint: Corner;
      if (nearestCorner && nearestDistance < maxBranchDistance) {
        endpoint = nearestCorner;
        
        // Block the opposite direction on the target corner
        const toKey = getCornerKey(nearestCorner);
        const oppositeDir = getOppositeDir(dir);
        if (!blockedDirections.has(toKey)) {
          blockedDirections.set(toKey, new Set());
        }
        blockedDirections.get(toKey)!.add(oppositeDir);
      } else {
        // Create virtual corner at screen edge
        let edgeX = from.x;
        let edgeY = from.y;

        if (dir === 'left') edgeX = 0;
        else if (dir === 'right') edgeX = screenWidth;
        else if (dir === 'up') edgeY = 0;
        else if (dir === 'down') edgeY = screenHeight;

        const edgeDistance = Math.sqrt(
          Math.pow(edgeX - from.x, 2) + Math.pow(edgeY - from.y, 2)
        );

        if (edgeDistance > maxBranchDistance) continue;

        endpoint = {
          elementId: 'edge',
          x: edgeX,
          y: edgeY,
          position: 'top-left',
        };
      }

      newBranches.push({
        from,
        to: endpoint,
        distance: Math.sqrt(
          Math.pow(endpoint.x - from.x, 2) + Math.pow(endpoint.y - from.y, 2)
        ),
      });
    }
  }

  return newBranches;
}
