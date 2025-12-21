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
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
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
    : "bg-white border-gray-300";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 p-2 rounded border ${bgColor} ${
        isDragging ? "shadow-lg" : ""
      }`}
    >
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing"
      >
        <GripVertical className="w-4 h-4 text-gray-400" />
      </div>
      {showLineNumbers && (
        <span className="text-xs text-gray-500 w-6 text-right">
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
      if (parsonsProblemData.blocks.length === 0) return;

      // Combine correct blocks and distractors, then shuffle
      // Note: blocks array is filtered out for students, so we need to reconstruct from available data
      const blocks = (parsonsProblemData as any).blocks || [];
      const allBlocks: ParsonsProblemBlock[] = [
        ...blocks,
        ...(parsonsProblemData.distractorBlocks || []).map((d) => ({
          id: d.id,
          code: d.code,
          indentLevel: 0,
        })),
      ];

      // Shuffle array
      const shuffled = [...allBlocks].sort(() => Math.random() - 0.5);
      setAvailableBlocks(shuffled);
      setSolutionBlocks([]);
    }, [parsonsProblemData]);

    // Load initial state from editor storage
    useEffect(() => {
      const getBlockAnswerState = (editor?.storage as any)?.getBlockAnswerState;
      if (getBlockAnswerState && parsonsProblemData.id) {
        const blockState: BlockAnswerState = getBlockAnswerState(
          parsonsProblemData.id
        );
        if (blockState && blockState.solution) {
          // Restore solution order
          const blocks = (parsonsProblemData as any).blocks || [];
          const restored = blockState.solution
            .map((id) => {
              const block = [...blocks, ...(parsonsProblemData.distractorBlocks || []).map(d => ({
                id: d.id,
                code: d.code,
                indentLevel: 0,
              }))].find((b) => b.id === id);
              return block;
            })
            .filter(Boolean) as ParsonsProblemBlock[];

          if (restored.length > 0) {
            setSolutionBlocks(restored);
            const remaining = availableBlocks.filter(
              (b) => !restored.find((r) => r.id === b.id)
            );
            setAvailableBlocks(remaining);
          }
        }
      }
    }, [editor, parsonsProblemData.id, parsonsProblemData.distractorBlocks, availableBlocks]);

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

    const handleDragEnd = useCallback(
      (event: DragEndEvent) => {
        const { active, over } = event;
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

        if (isInAvailable && overId === "solution-area") {
          // Move from available to solution
          setAvailableBlocks(availableBlocks.filter((b) => b.id !== activeId));
          setSolutionBlocks([...solutionBlocks, draggedBlock]);
          setIsAnswerChanged(true);
        } else if (isInSolution && overId === "available-area") {
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
        <div className="parsons-problem-viewer border border-gray-200 rounded-lg p-4 bg-white shadow-sm my-4">
          {hasDataError && (
            <div className="mb-3 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-800">
              <AlertTriangle className="w-4 h-4 inline mr-1" />
              This block has some configuration issues but is still functional.
            </div>
          )}

          {parsonsProblemData.instruction && (
            <div className="mb-4 text-sm text-gray-700">
              {parsonsProblemData.instruction}
            </div>
          )}

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <div className="grid grid-cols-2 gap-4 mb-4">
              {/* Available Blocks */}
              <div>
                <div className="text-sm font-medium text-gray-700 mb-2">
                  Available Blocks
                </div>
                <div
                  id="available-area"
                  className="min-h-[200px] p-3 bg-gray-50 border-2 border-dashed border-gray-300 rounded"
                >
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
                    <div className="text-sm text-gray-400 text-center py-8">
                      All blocks used
                    </div>
                  )}
                </div>
              </div>

              {/* Solution Area */}
              <div>
                <div className="text-sm font-medium text-gray-700 mb-2">
                  Your Solution
                </div>
                <div
                  id="solution-area"
                  className="min-h-[200px] p-3 bg-blue-50 border-2 border-dashed border-blue-300 rounded"
                >
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
                    <div className="text-sm text-gray-400 text-center py-8">
                      Drag blocks here
                    </div>
                  )}
                </div>
              </div>
            </div>
          </DndContext>

        </div>
      </NodeViewWrapper>
    );
  }
);

export default ParsonsProblemViewer;
