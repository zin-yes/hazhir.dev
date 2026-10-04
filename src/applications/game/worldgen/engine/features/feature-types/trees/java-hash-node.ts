// HashMap.Node / HashMap.TreeNode for JavaHashPositionSet: the linked bin entry with the red-black tree links and the
// tree balancing routines (ported from OpenJDK 21 java.util.HashMap.TreeNode). Keys are block positions; they are
// never Comparable in the sense HashMap checks, so tree order is decided by the hash alone.

export interface PositionEntry {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** HashMap.Node, or HashMap.TreeNode when `isTree` is set (the tree links are only meaningful then). */
export class HashNode implements PositionEntry {
  next: HashNode | null = null;
  isTree = false;
  parent: HashNode | null = null;
  left: HashNode | null = null;
  right: HashNode | null = null;
  prev: HashNode | null = null;
  red = false;

  constructor(
    readonly x: number,
    readonly y: number,
    readonly z: number,
    readonly hash: number,
  ) {}

  matches(x: number, y: number, z: number): boolean {
    return this.x === x && this.y === y && this.z === z;
  }

  root(): HashNode {
    let node: HashNode = this;
    while (node.parent !== null) node = node.parent;
    return node;
  }

  /** TreeNode.find without Comparable keys. */
  find(hash: number, x: number, y: number, z: number): HashNode | null {
    let node: HashNode | null = this;
    do {
      const left: HashNode | null = node.left;
      const right: HashNode | null = node.right;
      if (node.hash > hash) node = left;
      else if (node.hash < hash) node = right;
      else if (node.matches(x, y, z)) return node;
      else if (left === null) node = right;
      else if (right === null) node = left;
      else {
        const found = right.find(hash, x, y, z);
        if (found !== null) return found;
        node = left;
      }
    } while (node !== null);
    return null;
  }

  untreeifyChain(): HashNode {
    for (let node: HashNode | null = this; node !== null; node = node.next) {
      node.isTree = false;
      node.parent = node.left = node.right = node.prev = null;
      node.red = false;
    }
    return this;
  }
}

function rotateLeft(root: HashNode, pivot: HashNode | null): HashNode {
  let newRoot = root;
  let right: HashNode | null;
  if (pivot !== null && (right = pivot.right) !== null) {
    const rightLeft = (pivot.right = right.left);
    if (rightLeft !== null) rightLeft.parent = pivot;
    const pivotParent = (right.parent = pivot.parent);
    if (pivotParent === null) {
      newRoot = right;
      right.red = false;
    } else if (pivotParent.left === pivot) pivotParent.left = right;
    else pivotParent.right = right;
    right.left = pivot;
    pivot.parent = right;
  }
  return newRoot;
}

function rotateRight(root: HashNode, pivot: HashNode | null): HashNode {
  let newRoot = root;
  let left: HashNode | null;
  if (pivot !== null && (left = pivot.left) !== null) {
    const leftRight = (pivot.left = left.right);
    if (leftRight !== null) leftRight.parent = pivot;
    const pivotParent = (left.parent = pivot.parent);
    if (pivotParent === null) {
      newRoot = left;
      left.red = false;
    } else if (pivotParent.right === pivot) pivotParent.right = left;
    else pivotParent.left = left;
    left.right = pivot;
    pivot.parent = left;
  }
  return newRoot;
}

export function balanceInsertion(rootNode: HashNode, inserted: HashNode): HashNode {
  let root = rootNode;
  let node = inserted;
  node.red = true;
  for (;;) {
    const parent: HashNode | null = node.parent;
    if (parent === null) {
      node.red = false;
      return node;
    }
    let grandparent: HashNode | null = parent.parent;
    if (!parent.red || grandparent === null) return root;
    const grandparentLeft: HashNode | null = grandparent.left;
    if (parent === grandparentLeft) {
      const uncle: HashNode | null = grandparent.right;
      if (uncle !== null && uncle.red) {
        uncle.red = false;
        parent.red = false;
        grandparent.red = true;
        node = grandparent;
      } else {
        let currentParent: HashNode | null = parent;
        if (node === parent.right) {
          node = parent;
          root = rotateLeft(root, node);
          currentParent = node.parent;
          grandparent = currentParent === null ? null : currentParent.parent;
        }
        if (currentParent !== null) {
          currentParent.red = false;
          if (grandparent !== null) {
            grandparent.red = true;
            root = rotateRight(root, grandparent);
          }
        }
      }
    } else if (grandparentLeft !== null && grandparentLeft.red) {
      grandparentLeft.red = false;
      parent.red = false;
      grandparent.red = true;
      node = grandparent;
    } else {
      let currentParent: HashNode | null = parent;
      if (node === parent.left) {
        node = parent;
        root = rotateRight(root, node);
        currentParent = node.parent;
        grandparent = currentParent === null ? null : currentParent.parent;
      }
      if (currentParent !== null) {
        currentParent.red = false;
        if (grandparent !== null) {
          grandparent.red = true;
          root = rotateLeft(root, grandparent);
        }
      }
    }
  }
}

export function balanceDeletion(rootNode: HashNode, start: HashNode | null): HashNode {
  let root = rootNode;
  let node = start;
  for (;;) {
    if (node === null || node === root) return root;
    let parent: HashNode | null = node.parent;
    if (parent === null) {
      node.red = false;
      return node;
    }
    if (node.red) {
      node.red = false;
      return root;
    }
    const parentLeft: HashNode | null = parent.left;
    if (parentLeft === node) {
      let sibling: HashNode | null = parent.right;
      if (sibling !== null && sibling.red) {
        sibling.red = false;
        parent.red = true;
        root = rotateLeft(root, parent);
        parent = node.parent;
        sibling = parent === null ? null : parent.right;
      }
      if (sibling === null) node = parent;
      else {
        const siblingLeft = sibling.left;
        let siblingRight = sibling.right;
        if ((siblingRight === null || !siblingRight.red) && (siblingLeft === null || !siblingLeft.red)) {
          sibling.red = true;
          node = parent;
        } else {
          if (siblingRight === null || !siblingRight.red) {
            if (siblingLeft !== null) siblingLeft.red = false;
            sibling.red = true;
            root = rotateRight(root, sibling);
            parent = node.parent;
            sibling = parent === null ? null : parent.right;
          }
          if (sibling !== null) {
            sibling.red = parent === null ? false : parent.red;
            siblingRight = sibling.right;
            if (siblingRight !== null) siblingRight.red = false;
          }
          if (parent !== null) {
            parent.red = false;
            root = rotateLeft(root, parent);
          }
          node = root;
        }
      }
    } else {
      let sibling: HashNode | null = parentLeft;
      if (sibling !== null && sibling.red) {
        sibling.red = false;
        parent.red = true;
        root = rotateRight(root, parent);
        parent = node.parent;
        sibling = parent === null ? null : parent.left;
      }
      if (sibling === null) node = parent;
      else {
        let siblingLeft = sibling.left;
        const siblingRight = sibling.right;
        if ((siblingLeft === null || !siblingLeft.red) && (siblingRight === null || !siblingRight.red)) {
          sibling.red = true;
          node = parent;
        } else {
          if (siblingLeft === null || !siblingLeft.red) {
            if (siblingRight !== null) siblingRight.red = false;
            sibling.red = true;
            root = rotateLeft(root, sibling);
            parent = node.parent;
            sibling = parent === null ? null : parent.left;
          }
          if (sibling !== null) {
            sibling.red = parent === null ? false : parent.red;
            siblingLeft = sibling.left;
            if (siblingLeft !== null) siblingLeft.red = false;
          }
          if (parent !== null) {
            parent.red = false;
            root = rotateRight(root, parent);
          }
          node = root;
        }
      }
    }
  }
}
