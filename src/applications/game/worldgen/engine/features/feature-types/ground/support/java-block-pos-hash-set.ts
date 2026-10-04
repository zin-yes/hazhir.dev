// Iteration order of a java.util.HashSet<BlockPos> (a HashMap with default capacity 16 and load factor 0.75), which
// VegetationPatchFeature iterates to decide the order of its random draws. Ported from JDK 21 HashMap, insertion
// only: BlockPos.hashCode is (y + z * 31) * 31 + x, spread by h ^ (h >>> 16); buckets keep insertion order, a bucket
// that reaches nine nodes in a table of 64 or more buckets becomes a red-black tree (TreeNode, whose `next` chain
// order moves the root to the front), and a resize splits every bin into a low and a high bin preserving order.
// Keys are not Comparable, so tree ordering uses the full spread hash; two distinct positions with an equal spread
// hash would fall back to System.identityHashCode in Java (nondeterministic) and are placed on the left here.

const DEFAULT_CAPACITY = 16;
const TREEIFY_THRESHOLD = 8;
const MIN_TREEIFY_CAPACITY = 64;
const UNTREEIFY_THRESHOLD = 6;

class HashNode<Value> {
  next: HashNode<Value> | null = null;

  constructor(
    readonly hash: number,
    readonly x: number,
    readonly y: number,
    readonly z: number,
    readonly value: Value,
  ) {}
}

/** HashMap.TreeNode: the red-black tree fields plus the doubly linked `prev`/`next` chain that iteration follows. */
class TreeNode<Value> extends HashNode<Value> {
  parent: TreeNode<Value> | null = null;
  left: TreeNode<Value> | null = null;
  right: TreeNode<Value> | null = null;
  prev: TreeNode<Value> | null = null;
  red = false;
}

function blockPosHashCode(x: number, y: number, z: number): number {
  return (Math.imul((y + Math.imul(z, 31)) | 0, 31) + x) | 0;
}

function rotateLeft<Value>(root: TreeNode<Value>, pivot: TreeNode<Value> | null): TreeNode<Value> {
  let newRoot = root;
  const right = pivot?.right ?? null;
  if (pivot && right) {
    const rightLeft = (pivot.right = right.left);
    if (rightLeft) rightLeft.parent = pivot;
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

function rotateRight<Value>(root: TreeNode<Value>, pivot: TreeNode<Value> | null): TreeNode<Value> {
  let newRoot = root;
  const left = pivot?.left ?? null;
  if (pivot && left) {
    const leftRight = (pivot.left = left.right);
    if (leftRight) leftRight.parent = pivot;
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

/** TreeNode.balanceInsertion. */
function balanceInsertion<Value>(initialRoot: TreeNode<Value>, inserted: TreeNode<Value>): TreeNode<Value> {
  let root = initialRoot;
  let node = inserted;
  node.red = true;
  for (;;) {
    const parent = node.parent;
    if (parent === null) {
      node.red = false;
      return node;
    }
    let grandparent = parent.parent;
    if (!parent.red || grandparent === null) return root;
    if (parent === grandparent.left) {
      const uncle = grandparent.right;
      if (uncle && uncle.red) {
        uncle.red = false;
        parent.red = false;
        grandparent.red = true;
        node = grandparent;
      } else {
        let currentParent: TreeNode<Value> | null = parent;
        if (node === parent.right) {
          node = parent;
          root = rotateLeft(root, node);
          currentParent = node.parent;
          grandparent = currentParent === null ? null : currentParent.parent;
        }
        if (currentParent) {
          currentParent.red = false;
          if (grandparent) {
            grandparent.red = true;
            root = rotateRight(root, grandparent);
          }
        }
      }
    } else {
      const uncle = grandparent.left;
      if (uncle && uncle.red) {
        uncle.red = false;
        parent.red = false;
        grandparent.red = true;
        node = grandparent;
      } else {
        let currentParent: TreeNode<Value> | null = parent;
        if (node === parent.left) {
          node = parent;
          root = rotateRight(root, node);
          currentParent = node.parent;
          grandparent = currentParent === null ? null : currentParent.parent;
        }
        if (currentParent) {
          currentParent.red = false;
          if (grandparent) {
            grandparent.red = true;
            root = rotateLeft(root, grandparent);
          }
        }
      }
    }
  }
}

export class JavaBlockPosHashSet<Value> {
  private table: Array<HashNode<Value> | undefined> = [];
  private threshold = 0;
  private count = 0;

  get size(): number {
    return this.count;
  }

  /** HashSet.add: false (and no change) when the position is already present. */
  add(x: number, y: number, z: number, value: Value): boolean {
    if (this.table.length === 0) this.resize();
    const rawHash = blockPosHashCode(x, y, z);
    const hash = rawHash ^ (rawHash >>> 16);
    const index = hash & (this.table.length - 1);
    const first = this.table[index];
    if (!first) {
      this.table[index] = new HashNode(hash, x, y, z, value);
    } else if (first instanceof TreeNode) {
      if (!this.putTreeValue(first, hash, x, y, z, value)) return false;
    } else {
      let node: HashNode<Value> = first;
      for (let binCount = 0; ; binCount++) {
        if (node.x === x && node.y === y && node.z === z) return false;
        if (node.next === null) {
          node.next = new HashNode(hash, x, y, z, value);
          if (binCount >= TREEIFY_THRESHOLD - 1) this.treeifyBin(hash);
          break;
        }
        node = node.next;
      }
    }
    if (++this.count > this.threshold) this.resize();
    return true;
  }

  contains(x: number, y: number, z: number): boolean {
    return this.entries().some((entry) => entry.x === x && entry.y === y && entry.z === z);
  }

  /** HashSet iteration: ascending bucket index, then the bin's `next` chain. */
  entries(): Array<{ x: number; y: number; z: number; value: Value }> {
    const ordered: Array<{ x: number; y: number; z: number; value: Value }> = [];
    for (const first of this.table) {
      for (let node = first ?? null; node; node = node.next) ordered.push(node);
    }
    return ordered;
  }

  private resize(): void {
    const oldTable = this.table;
    const oldCapacity = oldTable.length;
    const newCapacity = oldCapacity === 0 ? DEFAULT_CAPACITY : oldCapacity * 2;
    this.threshold = Math.floor(newCapacity * 0.75);
    this.table = new Array(newCapacity);
    for (let index = 0; index < oldCapacity; index++) {
      const first = oldTable[index];
      if (!first) continue;
      if (first.next === null) {
        this.table[first.hash & (newCapacity - 1)] = first;
      } else if (first instanceof TreeNode) {
        this.splitTree(first, index, oldCapacity);
      } else {
        let lowHead: HashNode<Value> | null = null;
        let lowTail: HashNode<Value> | null = null;
        let highHead: HashNode<Value> | null = null;
        let highTail: HashNode<Value> | null = null;
        for (let node: HashNode<Value> | null = first, next: HashNode<Value> | null; node; node = next) {
          next = node.next;
          if ((node.hash & oldCapacity) === 0) {
            if (lowTail === null) lowHead = node;
            else lowTail.next = node;
            lowTail = node;
          } else {
            if (highTail === null) highHead = node;
            else highTail.next = node;
            highTail = node;
          }
        }
        if (lowTail) {
          lowTail.next = null;
          this.table[index] = lowHead!;
        }
        if (highTail) {
          highTail.next = null;
          this.table[index + oldCapacity] = highHead!;
        }
      }
    }
  }

  /** HashMap.treeifyBin. */
  private treeifyBin(hash: number): void {
    if (this.table.length < MIN_TREEIFY_CAPACITY) {
      this.resize();
      return;
    }
    const index = hash & (this.table.length - 1);
    let node = this.table[index] ?? null;
    let head: TreeNode<Value> | null = null;
    let tail: TreeNode<Value> | null = null;
    while (node) {
      const replacement = new TreeNode(node.hash, node.x, node.y, node.z, node.value);
      if (tail === null) head = replacement;
      else {
        replacement.prev = tail;
        tail.next = replacement;
      }
      tail = replacement;
      node = node.next;
    }
    if (head) {
      this.table[index] = head;
      this.treeify(head);
    }
  }

  /** TreeNode.treeify: rebuild the tree from the bin's list order and move the root to the front. */
  private treeify(head: TreeNode<Value>): void {
    let root: TreeNode<Value> | null = null;
    for (let node: TreeNode<Value> | null = head, next: TreeNode<Value> | null; node; node = next) {
      next = node.next as TreeNode<Value> | null;
      node.left = node.right = null;
      if (root === null) {
        node.parent = null;
        node.red = false;
        root = node;
        continue;
      }
      let current: TreeNode<Value> = root;
      for (;;) {
        const direction = current.hash > node.hash ? -1 : current.hash < node.hash ? 1 : -1;
        const parent = current;
        const child = direction <= 0 ? current.left : current.right;
        if (child === null) {
          node.parent = parent;
          if (direction <= 0) parent.left = node;
          else parent.right = node;
          root = balanceInsertion(root, node);
          break;
        }
        current = child;
      }
    }
    if (root) this.moveRootToFront(root);
  }

  /** TreeNode.putTreeVal for a position that is not a duplicate of a key already in the bin. */
  private putTreeValue(first: TreeNode<Value>, hash: number, x: number, y: number, z: number, value: Value): boolean {
    let root: TreeNode<Value> = first;
    while (root.parent) root = root.parent;
    let current: TreeNode<Value> = root;
    for (;;) {
      let direction: number;
      if (current.hash > hash) direction = -1;
      else if (current.hash < hash) direction = 1;
      else if (current.x === x && current.y === y && current.z === z) return false;
      else direction = this.findEqualHashDuplicate(current, x, y, z) ? 0 : -1;
      if (direction === 0) return false;
      const parent = current;
      const child = direction <= 0 ? current.left : current.right;
      if (child === null) {
        const parentNext = parent.next as TreeNode<Value> | null;
        const inserted = new TreeNode(hash, x, y, z, value);
        inserted.next = parentNext;
        if (direction <= 0) parent.left = inserted;
        else parent.right = inserted;
        parent.next = inserted;
        inserted.parent = inserted.prev = parent;
        if (parentNext) parentNext.prev = inserted;
        this.moveRootToFront(balanceInsertion(root, inserted));
        return true;
      }
      current = child;
    }
  }

  /** The duplicate search putTreeVal runs before a tie break: is the position already in the subtree below `node`? */
  private findEqualHashDuplicate(node: TreeNode<Value>, x: number, y: number, z: number): boolean {
    const stack: Array<TreeNode<Value> | null> = [node];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) continue;
      if (current.x === x && current.y === y && current.z === z) return true;
      stack.push(current.left, current.right);
    }
    return false;
  }

  /** TreeNode.moveRootToFront. */
  private moveRootToFront(root: TreeNode<Value>): void {
    const index = root.hash & (this.table.length - 1);
    const first = this.table[index] as TreeNode<Value> | undefined;
    if (root === first) return;
    this.table[index] = root;
    const rootPrevious = root.prev;
    const rootNext = root.next as TreeNode<Value> | null;
    if (rootNext) rootNext.prev = rootPrevious;
    if (rootPrevious) rootPrevious.next = rootNext;
    if (first) first.prev = root;
    root.next = first ?? null;
    root.prev = null;
  }

  /** TreeNode.split: divide a tree bin into low and high bins during a resize. */
  private splitTree(first: TreeNode<Value>, index: number, bit: number): void {
    let lowHead: TreeNode<Value> | null = null;
    let lowTail: TreeNode<Value> | null = null;
    let highHead: TreeNode<Value> | null = null;
    let highTail: TreeNode<Value> | null = null;
    let lowCount = 0;
    let highCount = 0;
    for (let node: TreeNode<Value> | null = first, next: TreeNode<Value> | null; node; node = next) {
      next = node.next as TreeNode<Value> | null;
      node.next = null;
      if ((node.hash & bit) === 0) {
        node.prev = lowTail;
        if (lowTail === null) lowHead = node;
        else lowTail.next = node;
        lowTail = node;
        lowCount++;
      } else {
        node.prev = highTail;
        if (highTail === null) highHead = node;
        else highTail.next = node;
        highTail = node;
        highCount++;
      }
    }
    if (lowHead) {
      if (lowCount <= UNTREEIFY_THRESHOLD) this.table[index] = this.untreeify(lowHead);
      else {
        this.table[index] = lowHead;
        if (highHead) this.treeify(lowHead);
      }
    }
    if (highHead) {
      if (highCount <= UNTREEIFY_THRESHOLD) this.table[index + bit] = this.untreeify(highHead);
      else {
        this.table[index + bit] = highHead;
        if (lowHead) this.treeify(highHead);
      }
    }
  }

  /** TreeNode.untreeify: back to plain nodes in the same order. */
  private untreeify(head: TreeNode<Value>): HashNode<Value> {
    let first: HashNode<Value> | null = null;
    let tail: HashNode<Value> | null = null;
    for (let node: HashNode<Value> | null = head; node; node = node.next) {
      const plain = new HashNode(node.hash, node.x, node.y, node.z, node.value);
      if (tail === null) first = plain;
      else tail.next = plain;
      tail = plain;
    }
    return first!;
  }
}
