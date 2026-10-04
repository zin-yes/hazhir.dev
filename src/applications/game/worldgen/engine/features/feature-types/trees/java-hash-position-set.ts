// A HashSet<BlockPos> that reproduces java.util.HashSet iteration order, ported from OpenJDK 21 HashMap (table
// growth, bucket lists and the red-black tree bins). TreeFeature collects logs, leaves and roots in HashSets and the
// tree decorators then walk copies of them, so the order in which a decorator draws its random numbers (and the order
// of the leaf distance updates) depends on the bucket layout.
//
// Block positions collide a lot (Vec3i.hashCode = (y + z * 31) * 31 + x is nearly linear; positions on an
// anti-diagonal share a bucket in tables up to 64), so the collision paths matter: a bin that reaches nine nodes
// resizes a table smaller than 64 buckets or turns into a tree bin, and tree bins reorder their linked list (a new
// node is linked after its tree parent, the root moves to the front). Distinct positions near a tree never share a
// full 32-bit hash, so the identity-hash tie break of HashMap.tieBreakOrder is never needed.

import { HashNode, type PositionEntry, balanceDeletion, balanceInsertion } from "./java-hash-node";

export type { PositionEntry };

const TREEIFY_THRESHOLD = 8;
const UNTREEIFY_THRESHOLD = 6;
const MIN_TREEIFY_CAPACITY = 64;
const INITIAL_CAPACITY = 16;

/** Vec3i.hashCode spread the way HashMap.hash does. */
export function javaPositionHash(x: number, y: number, z: number): number {
  const hashCode = (Math.imul((y + Math.imul(z, 31)) | 0, 31) + x) | 0;
  return hashCode ^ (hashCode >>> 16);
}

export class JavaHashPositionSet {
  private table: Array<HashNode | null> = [];
  private threshold = 0;
  private entryCount = 0;
  /** Lower bound of the first occupied bucket, so first() does not rescan from bucket 0 after every removal. */
  private firstOccupiedBucketHint = 0;

  get size(): number {
    return this.entryCount;
  }

  isEmpty(): boolean {
    return this.entryCount === 0;
  }

  contains(x: number, y: number, z: number): boolean {
    return this.getNode(javaPositionHash(x, y, z), x, y, z) !== null;
  }

  /** HashMap.putVal: returns false when the position was already present. */
  add(x: number, y: number, z: number): boolean {
    if (this.table.length === 0) this.resize();
    const hash = javaPositionHash(x, y, z);
    const index = (this.table.length - 1) & hash;
    let first = this.table[index]!;
    if (index < this.firstOccupiedBucketHint) this.firstOccupiedBucketHint = index;
    if (first === null || first === undefined) {
      this.table[index] = new HashNode(x, y, z, hash);
    } else {
      let existing: HashNode | null;
      if (first.hash === hash && first.matches(x, y, z)) existing = first;
      else if (first.isTree) existing = this.putTreeVal(first, hash, x, y, z);
      else {
        existing = null;
        for (let binCount = 0; ; binCount++) {
          const following: HashNode | null = first.next;
          if (following === null) {
            first.next = new HashNode(x, y, z, hash);
            if (binCount >= TREEIFY_THRESHOLD - 1) this.treeifyBin(hash);
            break;
          }
          if (following.hash === hash && following.matches(x, y, z)) {
            existing = following;
            break;
          }
          first = following;
        }
      }
      if (existing !== null) return false;
    }
    if (++this.entryCount > this.threshold) this.resize();
    return true;
  }

  /** HashSet.remove (HashMap.removeNode with movable = true). */
  remove(x: number, y: number, z: number): boolean {
    return this.removeNode(x, y, z, true);
  }

  /** `iterator().next()` followed by `iterator.remove()`, which removes with movable = false (tree bins keep their shape). */
  pollFirst(): PositionEntry | undefined {
    const first = this.first();
    if (first === undefined) return undefined;
    const popped = { x: first.x, y: first.y, z: first.z };
    this.removeNode(popped.x, popped.y, popped.z, false);
    return popped;
  }

  private removeNode(x: number, y: number, z: number, movable: boolean): boolean {
    const table = this.table;
    if (table.length === 0) return false;
    const hash = javaPositionHash(x, y, z);
    const index = (table.length - 1) & hash;
    let first = table[index];
    if (first === null || first === undefined) return false;
    let node: HashNode | null = null;
    if (first.hash === hash && first.matches(x, y, z)) node = first;
    else if (first.next !== null) {
      if (first.isTree) node = this.getTreeNode(first, hash, x, y, z);
      else {
        let following: HashNode | null = first.next;
        do {
          if (following.hash === hash && following.matches(x, y, z)) {
            node = following;
            break;
          }
          first = following;
        } while ((following = following.next) !== null);
      }
    }
    if (node === null) return false;
    if (node.isTree) this.removeTreeNode(node, movable);
    else if (node === table[index]) table[index] = node.next;
    else first.next = node.next;
    this.entryCount--;
    return true;
  }

  /** The first element of iterator(), or undefined when empty. */
  first(): PositionEntry | undefined {
    for (let bucket = this.firstOccupiedBucketHint; bucket < this.table.length; bucket++) {
      const head = this.table[bucket];
      if (head !== null && head !== undefined) {
        this.firstOccupiedBucketHint = bucket;
        return head;
      }
    }
    this.firstOccupiedBucketHint = this.table.length;
    return undefined;
  }

  /** Every element in iterator() order. */
  values(): PositionEntry[] {
    const ordered: PositionEntry[] = [];
    for (const head of this.table) {
      for (let node = head ?? null; node !== null; node = node.next) ordered.push(node);
    }
    return ordered;
  }

  private getNode(hash: number, x: number, y: number, z: number): HashNode | null {
    if (this.table.length === 0) return null;
    const first = this.table[(this.table.length - 1) & hash];
    if (first === null || first === undefined) return null;
    if (first.hash === hash && first.matches(x, y, z)) return first;
    if (first.next === null) return null;
    if (first.isTree) return this.getTreeNode(first, hash, x, y, z);
    for (let node: HashNode | null = first.next; node !== null; node = node.next) {
      if (node.hash === hash && node.matches(x, y, z)) return node;
    }
    return null;
  }

  private getTreeNode(first: HashNode, hash: number, x: number, y: number, z: number): HashNode | null {
    return (first.parent !== null ? first.root() : first).find(hash, x, y, z);
  }

  private resize(): void {
    const oldTable = this.table;
    const oldCapacity = oldTable.length;
    let newCapacity: number;
    let newThreshold: number;
    if (oldCapacity > 0) {
      newCapacity = oldCapacity << 1;
      newThreshold = this.threshold << 1;
    } else {
      newCapacity = INITIAL_CAPACITY;
      newThreshold = Math.trunc(0.75 * INITIAL_CAPACITY);
    }
    this.threshold = newThreshold;
    const newTable: Array<HashNode | null> = new Array(newCapacity).fill(null);
    this.table = newTable;
    this.firstOccupiedBucketHint = 0;
    for (let bucket = 0; bucket < oldCapacity; bucket++) {
      const head = oldTable[bucket];
      if (head === null || head === undefined) continue;
      if (head.next === null) {
        newTable[head.hash & (newCapacity - 1)] = head;
      } else if (head.isTree) {
        this.split(head, newTable, bucket, oldCapacity);
      } else {
        let lowHead: HashNode | null = null;
        let lowTail: HashNode | null = null;
        let highHead: HashNode | null = null;
        let highTail: HashNode | null = null;
        let node: HashNode | null = head;
        while (node !== null) {
          const following: HashNode | null = node.next;
          if ((node.hash & oldCapacity) === 0) {
            if (lowTail === null) lowHead = node;
            else lowTail.next = node;
            lowTail = node;
          } else {
            if (highTail === null) highHead = node;
            else highTail.next = node;
            highTail = node;
          }
          node = following;
        }
        if (lowTail !== null) {
          lowTail.next = null;
          newTable[bucket] = lowHead;
        }
        if (highTail !== null) {
          highTail.next = null;
          newTable[bucket + oldCapacity] = highHead;
        }
      }
    }
  }

  /** HashMap.treeifyBin: a table under 64 buckets grows instead. */
  private treeifyBin(hash: number): void {
    if (this.table.length < MIN_TREEIFY_CAPACITY) {
      this.resize();
      return;
    }
    const index = (this.table.length - 1) & hash;
    let node = this.table[index] ?? null;
    if (node === null) return;
    let previous: HashNode | null = null;
    const head = node;
    while (node !== null) {
      node.isTree = true;
      node.prev = previous;
      previous = node;
      node = node.next;
    }
    this.treeify(head);
  }

  /** TreeNode.treeify: builds the red-black tree over the bin's list, then moves the root to the front. */
  private treeify(head: HashNode): void {
    let root: HashNode | null = null;
    for (let node: HashNode | null = head; node !== null; ) {
      const following: HashNode | null = node.next;
      node.left = node.right = null;
      if (root === null) {
        node.parent = null;
        node.red = false;
        root = node;
      } else {
        let current: HashNode | null = root;
        for (;;) {
          const parent: HashNode = current;
          const direction: number = parent.hash > node.hash ? -1 : parent.hash < node.hash ? 1 : -1;
          current = direction <= 0 ? parent.left : parent.right;
          if (current === null) {
            node.parent = parent;
            if (direction <= 0) parent.left = node;
            else parent.right = node;
            root = balanceInsertion(root, node);
            break;
          }
        }
      }
      node = following;
    }
    this.moveRootToFront(root);
  }

  private moveRootToFront(root: HashNode | null): void {
    if (root === null || this.table.length === 0) return;
    const index = (this.table.length - 1) & root.hash;
    const first = this.table[index] ?? null;
    if (root === first) return;
    this.table[index] = root;
    const rootPrevious = root.prev;
    const rootNext = root.next;
    if (rootNext !== null) rootNext.prev = rootPrevious;
    if (rootPrevious !== null) rootPrevious.next = rootNext;
    if (first !== null) first.prev = root;
    root.next = first;
    root.prev = null;
  }

  /** TreeNode.putTreeVal: returns the existing node, or null after inserting. */
  private putTreeVal(first: HashNode, hash: number, x: number, y: number, z: number): HashNode | null {
    const root = first.parent !== null ? first.root() : first;
    let searched = false;
    for (let current: HashNode = root; ; ) {
      let direction: number;
      if (current.hash > hash) direction = -1;
      else if (current.hash < hash) direction = 1;
      else if (current.matches(x, y, z)) return current;
      else {
        if (!searched) {
          searched = true;
          const found = (current.left?.find(hash, x, y, z) ?? null) ?? (current.right?.find(hash, x, y, z) ?? null);
          if (found !== null) return found;
        }
        direction = -1;
      }
      const parent = current;
      const child = direction <= 0 ? parent.left : parent.right;
      if (child === null) {
        const parentNext = parent.next;
        const inserted = new HashNode(x, y, z, hash);
        inserted.isTree = true;
        inserted.next = parentNext;
        if (direction <= 0) parent.left = inserted;
        else parent.right = inserted;
        parent.next = inserted;
        inserted.parent = inserted.prev = parent;
        if (parentNext !== null) parentNext.prev = inserted;
        this.moveRootToFront(balanceInsertion(root, inserted));
        return null;
      }
      current = child;
    }
  }

  /** TreeNode.removeTreeNode. */
  private removeTreeNode(node: HashNode, movable: boolean): void {
    const table = this.table;
    const index = (table.length - 1) & node.hash;
    let first: HashNode | null = table[index] ?? null;
    let root: HashNode | null = first;
    const successor = node.next;
    const predecessor = node.prev;
    if (predecessor === null) table[index] = first = successor;
    else predecessor.next = successor;
    if (successor !== null) successor.prev = predecessor;
    if (first === null) return;
    if (root!.parent !== null) root = root!.root();
    let rootLeft: HashNode | null;
    if (root === null || (movable && (root.right === null || (rootLeft = root.left) === null || rootLeft.left === null))) {
      table[index] = first.untreeifyChain();
      return;
    }
    const target = node;
    const targetLeft = target.left;
    const targetRight = target.right;
    let replacement: HashNode;
    if (targetLeft !== null && targetRight !== null) {
      let successorNode: HashNode = targetRight;
      let successorLeft: HashNode | null;
      while ((successorLeft = successorNode.left) !== null) successorNode = successorLeft;
      const swappedColor = successorNode.red;
      successorNode.red = target.red;
      target.red = swappedColor;
      const successorRight = successorNode.right;
      const targetParent = target.parent;
      if (successorNode === targetRight) {
        target.parent = successorNode;
        successorNode.right = target;
      } else {
        const successorParent = successorNode.parent;
        target.parent = successorParent;
        if (successorParent !== null) {
          if (successorNode === successorParent.left) successorParent.left = target;
          else successorParent.right = target;
        }
        successorNode.right = targetRight;
        targetRight.parent = successorNode;
      }
      target.left = null;
      target.right = successorRight;
      if (successorRight !== null) successorRight.parent = target;
      successorNode.left = targetLeft;
      targetLeft.parent = successorNode;
      successorNode.parent = targetParent;
      if (targetParent === null) root = successorNode;
      else if (target === targetParent.left) targetParent.left = successorNode;
      else targetParent.right = successorNode;
      replacement = successorRight !== null ? successorRight : target;
    } else if (targetLeft !== null) replacement = targetLeft;
    else if (targetRight !== null) replacement = targetRight;
    else replacement = target;
    if (replacement !== target) {
      const targetParent = (replacement.parent = target.parent);
      if (targetParent === null) {
        root = replacement;
        replacement.red = false;
      } else if (target === targetParent.left) targetParent.left = replacement;
      else targetParent.right = replacement;
      target.left = target.right = target.parent = null;
    }
    const newRoot = target.red ? root! : balanceDeletion(root!, replacement);
    if (replacement === target) {
      const targetParent = target.parent;
      target.parent = null;
      if (targetParent !== null) {
        if (target === targetParent.left) targetParent.left = null;
        else if (target === targetParent.right) targetParent.right = null;
      }
    }
    if (movable) this.moveRootToFront(newRoot);
  }

  /** TreeNode.split: a tree bin divides between index and index + oldCapacity, untreeifying small halves. */
  private split(head: HashNode, newTable: Array<HashNode | null>, index: number, oldCapacity: number): void {
    let lowHead: HashNode | null = null;
    let lowTail: HashNode | null = null;
    let highHead: HashNode | null = null;
    let highTail: HashNode | null = null;
    let lowCount = 0;
    let highCount = 0;
    for (let node: HashNode | null = head; node !== null; ) {
      const following: HashNode | null = node.next;
      node.next = null;
      if ((node.hash & oldCapacity) === 0) {
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
      node = following;
    }
    if (lowHead !== null) {
      if (lowCount <= UNTREEIFY_THRESHOLD) newTable[index] = lowHead.untreeifyChain();
      else {
        newTable[index] = lowHead;
        if (highHead !== null) this.treeify(lowHead);
      }
    }
    if (highHead !== null) {
      if (highCount <= UNTREEIFY_THRESHOLD) newTable[index + oldCapacity] = highHead.untreeifyChain();
      else {
        newTable[index + oldCapacity] = highHead;
        if (lowHead !== null) this.treeify(highHead);
      }
    }
  }
}
