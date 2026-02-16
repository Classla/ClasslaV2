import React, {
  useState,
  useEffect,
  memo,
  useCallback,
  useMemo,
} from "react";
import { NodeViewWrapper } from "@tiptap/react";
import {
  DragDropMatchingData,
  DragDropMatchingItem,
  DragDropMatchingTarget,
} from "../../extensions/DragDropMatchingBlock";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragOverlay,
  useDroppable,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";

interface DragDropMatchingViewerProps {
  node: any;
  editor: any;
  onAnswerChange?: (blockId: string, answer: any) => void;
}

interface MatchingAnswerState {
  matches: Record<string, string>; // itemId -> zoneId
  timestamp: Date;
}

interface SortableItemProps {
  item: DragDropMatchingItem;
  isDragging?: boolean;
  isMatched?: boolean;
}

const SortableItem: React.FC<SortableItemProps> = ({
  item,
  isDragging = false,
  isMatched = false,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: item.id, disabled: isMatched });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const bgColor = "bg-card border-border";

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`flex items-center gap-2 p-3 rounded border ${bgColor} ${
        isDragging ? "shadow-lg" : ""
      } ${isMatched ? "cursor-default" : "cursor-grab active:cursor-grabbing"}`}
    >
      {!isMatched && (
        <GripVertical className="w-4 h-4 text-muted-foreground flex-shrink-0" />
      )}
      <span className="flex-1 text-sm">{item.text}</span>
    </div>
  );
};

// Droppable zone component
const DroppableZone: React.FC<{ id: string; children: React.ReactNode }> = ({ id, children }) => {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={isOver ? "ring-2 ring-blue-400 rounded" : ""}
    >
      {children}
    </div>
  );
};

const DragDropMatchingViewer: React.FC<DragDropMatchingViewerProps> = memo(
  ({ node, editor, onAnswerChange }) => {
    const rawDragDropMatchingData = node.attrs
      .dragDropMatchingData as DragDropMatchingData;
    const [matches, setMatches] = useState<Record<string, string>>({});
    const [isAnswerChanged, setIsAnswerChanged] = useState(false);
    const [activeId, setActiveId] = useState<string | null>(null);

    // Randomize items if needed
    const sourceItems = useMemo(() => {
      if (!rawDragDropMatchingData.randomizeItems) {
        return rawDragDropMatchingData.sourceItems;
      }
      const shuffled = [...rawDragDropMatchingData.sourceItems];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled;
    }, [rawDragDropMatchingData.sourceItems, rawDragDropMatchingData.randomizeItems]);

    const sensors = useSensors(
      useSensor(PointerSensor),
      useSensor(KeyboardSensor, {
        coordinateGetter: sortableKeyboardCoordinates,
      })
    );

    // Load initial state from editor storage
    useEffect(() => {
      const getBlockAnswerState = (editor?.storage as any)?.getBlockAnswerState;
      if (getBlockAnswerState && rawDragDropMatchingData.id) {
        const blockState = getBlockAnswerState(rawDragDropMatchingData.id);
        if (blockState && blockState.matches) {
          setMatches(blockState.matches);
        }
      }
    }, [editor, rawDragDropMatchingData.id]);

    // Auto-save answer state when it changes
    useEffect(() => {
      if (!isAnswerChanged) return;

      const setBlockAnswerState = (editor?.storage as any)?.setBlockAnswerState;
      const blockId = rawDragDropMatchingData.id;
      if (setBlockAnswerState && blockId) {
        setBlockAnswerState(blockId, {
          matches,
          timestamp: new Date(),
        });
      }

      // Notify parent component
      const callback =
        (editor?.storage as any)?.dragDropMatchingAnswerCallback ||
        onAnswerChange;
      if (callback && blockId) {
        callback(blockId, { matches });
      }

      setIsAnswerChanged(false);
    }, [matches, rawDragDropMatchingData.id, editor, onAnswerChange, isAnswerChanged]);

    const handleDragStart = useCallback((event: any) => {
      setActiveId(event.active.id);
    }, []);

    const handleDragEnd = useCallback(
      (event: DragEndEvent) => {
        const { active, over } = event;
        setActiveId(null);

        if (!over) return;

        const itemId = active.id as string;
        const overId = over.id as string;

        // Check if dropping on a target zone
        const targetZone = rawDragDropMatchingData.targetZones.find(
          (z) => z.id === overId
        );

        if (targetZone) {
          if (rawDragDropMatchingData.matchType === "one-to-one") {
            // Remove item from any other zone first
            const newMatches = { ...matches };
            Object.keys(newMatches).forEach((key) => {
              if (newMatches[key] === overId || key === itemId) {
                delete newMatches[key];
              }
            });
            // Add to this zone
            newMatches[itemId] = overId;
            setMatches(newMatches);
            setIsAnswerChanged(true);
          } else {
            // Many-to-one: allow multiple items per zone
            setMatches({ ...matches, [itemId]: overId });
            setIsAnswerChanged(true);
          }
        } else if (overId === "source-area") {
          // Dropping back to source - remove from matches
          const newMatches = { ...matches };
          delete newMatches[itemId];
          setMatches(newMatches);
          setIsAnswerChanged(true);
        }
      },
      [matches, rawDragDropMatchingData]
    );

    const unmatchedItems = sourceItems.filter(
      (item) => !matches[item.id]
    );

    return (
      <NodeViewWrapper
        className="drag-drop-matching-viewer-wrapper"
        as="div"
        draggable={false}
        contentEditable={false}
      >
        <div className="drag-drop-matching-viewer border border-border rounded-lg p-4 bg-card shadow-sm">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-foreground mb-2">
              {rawDragDropMatchingData.instruction || "Match the items"}
            </h3>
          </div>

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <div className="grid grid-cols-2 gap-4">
              {/* Source Items Column */}
              <div>
                <div className="text-xs font-medium text-foreground mb-2">
                  Source Items
                </div>
                <DroppableZone id="source-area">
                  <SortableContext
                    items={unmatchedItems.map((item) => item.id)}
                    strategy={undefined}
                  >
                    <div className="space-y-2 min-h-[200px] p-2 bg-muted rounded border border-dashed border-border">
                      {unmatchedItems.map((item) => (
                        <SortableItem
                          key={item.id}
                          item={item}
                          isMatched={false}
                        />
                      ))}
                      {unmatchedItems.length === 0 && (
                        <div className="text-xs text-muted-foreground text-center py-4">
                          All items matched
                        </div>
                      )}
                    </div>
                  </SortableContext>
                </DroppableZone>
              </div>

              {/* Target Zones Column */}
              <div>
                <div className="text-xs font-medium text-foreground mb-2">
                  Target Zones
                </div>
                <div className="space-y-2 min-h-[200px]">
                  {rawDragDropMatchingData.targetZones.map((zone) => {
                    const matchedItems = sourceItems.filter(
                      (item) => matches[item.id] === zone.id
                    );
                    return (
                      <DroppableZone key={zone.id} id={zone.id}>
                        <div
                          className={`p-3 rounded border-2 border-dashed ${
                            matchedItems.length > 0
                              ? "bg-primary/10 border-primary/30"
                              : "bg-muted border-border"
                          }`}
                        >
                          <div className="text-sm font-medium text-foreground mb-2">
                            {zone.label}
                          </div>
                          <div className="space-y-1">
                            {matchedItems.map((item) => (
                              <div
                                key={item.id}
                                className="p-2 rounded text-xs bg-card border border-border"
                              >
                                {item.text}
                              </div>
                            ))}
                            {matchedItems.length === 0 && (
                              <div className="text-xs text-muted-foreground text-center py-2">
                                Drop items here
                              </div>
                            )}
                          </div>
                        </div>
                      </DroppableZone>
                    );
                  })}
                </div>
              </div>
            </div>

            <DragOverlay>
              {activeId ? (
                <div className="p-3 bg-card border border-border rounded shadow-lg">
                  {sourceItems.find((item) => item.id === activeId)?.text}
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>

        </div>
      </NodeViewWrapper>
    );
  }
);

export default DragDropMatchingViewer;

