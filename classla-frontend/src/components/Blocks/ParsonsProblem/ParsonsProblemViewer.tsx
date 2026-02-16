import React, {
  useState,
  useEffect,
  memo,
  useCallback,
  useMemo,
} from "react";
import { NodeViewWrapper } from "@tiptap/react";
import {
  ParsonsProblemData,
  ParsonsProblemBlock,
  validateParsonsProblemData,
  sanitizeParsonsProblemData,
} from "../../extensions/ParsonsProblemBlock";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragOverlay,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import {
  useDroppable,
} from "@dnd-kit/core";

// Droppable area component
const DroppableArea: React.FC<{ id: string; children: React.ReactNode }> = ({ id, children }) => {
  const { setNodeRef } = useDroppable({ id });
  return <div ref={setNodeRef}>{children}</div>;
};
import { CSS } from "@dnd-kit/utilities";
import { AlertTriangle, GripVertical } from "lucide-react";

interface ParsonsProblemViewerProps {
  node: any;
  editor: any;
  onAnswerChange?: (blockId: string, answer: any) => void;
}

interface BlockAnswerState {
  solution: string[]; // Array of block IDs in order
  timestamp: Date;
}

interface SortableBlockProps {
  block: ParsonsProblemBlock;
  indentSpaces: number;
  showLineNumbers: boolean;
  isDistractor: boolean;
}

const SortableBlock: React.FC<SortableBlockProps> = ({
  block,
  indentSpaces,
  showLineNumbers,
  isDistractor,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: block.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const bgColor = isDistractor
    ? "bg-yellow-50 border-yellow-300"
    : "bg-card border-border";

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`flex items-center gap-2 p-2 rounded border ${bgColor} cursor-grab active:cursor-grabbing ${
        isDragging ? "shadow-lg" : ""
      }`}
    >
      <GripVertical className="w-4 h-4 text-muted-foreground flex-shrink-0" />
      {showLineNumbers && (
        <span className="text-xs text-muted-foreground w-6 text-right flex-shrink-0">
          {block.indentLevel + 1}
        </span>
      )}
      <code className="flex-1 text-sm font-mono">
        {" ".repeat(block.indentLevel * indentSpaces)}
        {block.code}
      </code>
    </div>
  );
};

const ParsonsProblemViewer: React.FC<ParsonsProblemViewerProps> = memo(
  ({ node, editor, onAnswerChange }) => {
    const rawParsonsProblemData = node.attrs.parsonsProblemData as ParsonsProblemData;
    const [parsonsProblemData, setParsonsProblemData] = useState<ParsonsProblemData>(rawParsonsProblemData);
    const [availableBlocks, setAvailableBlocks] = useState<ParsonsProblemBlock[]>([]);
    const [solutionBlocks, setSolutionBlocks] = useState<ParsonsProblemBlock[]>([]);
    const [isAnswerChanged, setIsAnswerChanged] = useState(false);
    const [hasDataError, setHasDataError] = useState(false);
    const [activeId, setActiveId] = useState<string | null>(null);

    const sensors = useSensors(
      useSensor(PointerSensor),
      useSensor(KeyboardSensor, {
        coordinateGetter: sortableKeyboardCoordinates,
      })
    );

    // Validate and sanitize data on mount
    useEffect(() => {
      const validation = validateParsonsProblemData(rawParsonsProblemData, true);
      if (!validation.isValid) {
        console.warn(
          "Invalid Parsons Problem data in viewer, sanitizing:",
          validation.errors
        );
        const sanitizedData = sanitizeParsonsProblemData(rawParsonsProblemData);
        setParsonsProblemData(sanitizedData);
        setHasDataError(true);
      } else {
        setParsonsProblemData(rawParsonsProblemData);
        setHasDataError(false);
      }
    }, [rawParsonsProblemData]);

    // Initialize blocks - shuffle and split into available/solution
    useEffect(() => {
      if (parsonsProblemData.blocks.length === 0 && parsonsProblemData.distractorBlocks.length === 0) return;

      const getBlockAnswerState = (editor?.storage as any)?.getBlockAnswerState;
      const blockState: BlockAnswerState | null = getBlockAnswerState && parsonsProblemData.id
        ? getBlockAnswerState(parsonsProblemData.id)
        : null;

      // Combine correct blocks and distractors
      const blocks = (parsonsProblemData as any).blocks || [];
      const allBlocks: ParsonsProblemBlock[] = [
        ...blocks,
        ...(parsonsProblemData.distractorBlocks || []).map((d) => ({
          id: d.id,
          code: d.code,
          indentLevel: 0,
        })),
      ];

      // Remove duplicates by ID
      const uniqueBlocks = Array.from(
        new Map(allBlocks.map((b) => [b.id, b])).values()
      );

      // Shuffle array
      const shuffled = [...uniqueBlocks].sort(() => Math.random() - 0.5);

      // If we have saved state, restore it
      if (blockState && blockState.solution) {
        const restored = blockState.solution
          .map((id) => uniqueBlocks.find((b) => b.id === id))
          .filter(Boolean) as ParsonsProblemBlock[];

        const restoredIds = new Set(restored.map((b) => b.id));
        const remaining = shuffled.filter((b) => !restoredIds.has(b.id));

        setSolutionBlocks(restored);
        setAvailableBlocks(remaining);
      } else {
        setAvailableBlocks(shuffled);
        setSolutionBlocks([]);
      }
    }, [parsonsProblemData, editor]);

    // Auto-save answer state when it changes
    useEffect(() => {
      if (!isAnswerChanged || !parsonsProblemData.id) return;

      const setBlockAnswerState = (editor?.storage as any)?.setBlockAnswerState;
      if (setBlockAnswerState) {
        setBlockAnswerState(parsonsProblemData.id, {
          solution: solutionBlocks.map((b) => b.id),
          timestamp: new Date(),
        });
      }

      // Notify parent component
      const callback =
        (editor?.storage as any)?.parsonsProblemAnswerCallback ||
        onAnswerChange;
      callback?.(parsonsProblemData.id, {
        solution: solutionBlocks.map((b) => b.id),
      });

      setIsAnswerChanged(false);
    }, [solutionBlocks, parsonsProblemData.id, editor, onAnswerChange, isAnswerChanged]);

    const handleDragStart = useCallback((event: any) => {
      setActiveId(event.active.id);
    }, []);

    const handleDragEnd = useCallback(
      (event: DragEndEvent) => {
        const { active, over } = event;
        setActiveId(null);
        if (!over) return;

        const activeId = active.id as string;
        const overId = over.id as string;

        // Find the block being dragged
        const draggedBlock = [
          ...availableBlocks,
          ...solutionBlocks,
        ].find((b) => b.id === activeId);
        if (!draggedBlock) return;

        // Check if moving from available to solution or vice versa
        const isInAvailable = availableBlocks.some((b) => b.id === activeId);
        const isInSolution = solutionBlocks.some((b) => b.id === activeId);

        if (isInAvailable && (overId === "solution-area" || solutionBlocks.some((b) => b.id === overId))) {
          // Move from available to solution
          setAvailableBlocks(availableBlocks.filter((b) => b.id !== activeId));
          if (overId === "solution-area") {
            // Add to end
            setSolutionBlocks([...solutionBlocks, draggedBlock]);
          } else {
            // Insert at specific position
            const insertIndex = solutionBlocks.findIndex((b) => b.id === overId);
            if (insertIndex !== -1) {
              const newSolution = [...solutionBlocks];
              newSolution.splice(insertIndex, 0, draggedBlock);
              setSolutionBlocks(newSolution);
            } else {
              setSolutionBlocks([...solutionBlocks, draggedBlock]);
            }
          }
          setIsAnswerChanged(true);
        } else if (isInSolution && (overId === "available-area" || availableBlocks.some((b) => b.id === overId))) {
          // Move from solution to available
          setSolutionBlocks(solutionBlocks.filter((b) => b.id !== activeId));
          setAvailableBlocks([...availableBlocks, draggedBlock]);
          setIsAnswerChanged(true);
        } else if (isInSolution) {
          // Reorder within solution
          const oldIndex = solutionBlocks.findIndex((b) => b.id === activeId);
          const newIndex = solutionBlocks.findIndex((b) => b.id === overId);
          if (oldIndex !== -1 && newIndex !== -1) {
            setSolutionBlocks(arrayMove(solutionBlocks, oldIndex, newIndex));
            setIsAnswerChanged(true);
          }
        }
      },
      [availableBlocks, solutionBlocks]
    );


    const isReadOnly = (editor?.storage as any)?.isReadOnly;

    return (
      <NodeViewWrapper
        className="parsons-problem-viewer-wrapper"
        as="div"
        draggable={false}
        contentEditable={false}
      >
        <div className="parsons-problem-viewer border border-border rounded-lg p-4 bg-card shadow-sm my-4">
          {hasDataError && (
            <div className="mb-3 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-800">
              <AlertTriangle className="w-4 h-4 inline mr-1" />
              This block has some configuration issues but is still functional.
            </div>
          )}

          {parsonsProblemData.instruction && (
            <div className="mb-4 text-sm text-foreground">
              {parsonsProblemData.instruction}
            </div>
          )}

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <div className="grid grid-cols-2 gap-4 mb-4">
              {/* Available Blocks */}
              <div>
                <div className="text-sm font-medium text-foreground mb-2">
                  Available Blocks
                </div>
                <DroppableArea id="available-area">
                  <div className="min-h-[200px] p-3 bg-muted border-2 border-dashed border-border rounded">
                    <SortableContext
                      items={availableBlocks.map((b) => b.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <div className="space-y-2">
                        {availableBlocks.map((block) => {
                          const isDistractor = parsonsProblemData.distractorBlocks.some(
                            (d) => d.id === block.id
                          );
                          return (
                            <SortableBlock
                              key={block.id}
                              block={block}
                              indentSpaces={parsonsProblemData.indentSpaces || 4}
                              showLineNumbers={parsonsProblemData.showLineNumbers}
                              isDistractor={isDistractor}
                            />
                          );
                        })}
                      </div>
                    </SortableContext>
                    {availableBlocks.length === 0 && (
                      <div className="text-sm text-muted-foreground text-center py-8">
                        All blocks used
                      </div>
                    )}
                  </div>
                </DroppableArea>
              </div>

              {/* Solution Area */}
              <div>
                <div className="text-sm font-medium text-foreground mb-2">
                  Your Solution
                </div>
                <DroppableArea id="solution-area">
                  <div className="min-h-[200px] p-3 bg-blue-50 border-2 border-dashed border-blue-300 rounded">
                    <SortableContext
                      items={solutionBlocks.map((b) => b.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <div className="space-y-2">
                        {solutionBlocks.map((block, index) => {
                          const correctBlock = parsonsProblemData.blocks[index];
                          const isCorrectBlock =
                            correctBlock && correctBlock.id === block.id;
                          const isCorrectIndent =
                            !parsonsProblemData.enableIndentation ||
                            (correctBlock &&
                              correctBlock.indentLevel === block.indentLevel);
                          const isCorrect = isCorrectBlock && isCorrectIndent;

                          const isDistractor = parsonsProblemData.distractorBlocks.some(
                            (d) => d.id === block.id
                          );

                          return (
                            <SortableBlock
                              key={block.id}
                              block={block}
                              indentSpaces={parsonsProblemData.indentSpaces || 4}
                              showLineNumbers={parsonsProblemData.showLineNumbers}
                              isDistractor={isDistractor}
                            />
                          );
                        })}
                      </div>
                    </SortableContext>
                    {solutionBlocks.length === 0 && (
                      <div className="text-sm text-muted-foreground text-center py-8">
                        Drag blocks here
                      </div>
                    )}
                  </div>
                </DroppableArea>
              </div>
            </div>
            <DragOverlay>
              {activeId ? (
                <div className="flex items-center gap-2 p-2 rounded border bg-card border-border shadow-lg">
                  <GripVertical className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <code className="text-sm font-mono">
                    {[...availableBlocks, ...solutionBlocks].find((b) => b.id === activeId)?.code || ""}
                  </code>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>

        </div>
      </NodeViewWrapper>
    );
  }
);

export default ParsonsProblemViewer;
