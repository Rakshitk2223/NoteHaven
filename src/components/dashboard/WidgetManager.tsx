import { useState } from 'react';
import {
  GripVertical,
  X,
  Plus,
  RotateCcw,
  Maximize2,
  Eye,
  EyeOff
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import {
  type DashboardWidget,
  type WidgetSize,
  widgetMetadata,
  sizeLabels
} from '@/lib/dashboard';

interface WidgetManagerProps {
  isOpen: boolean;
  onClose: () => void;
  widgets: DashboardWidget[];
  onWidgetsChange: (widgets: DashboardWidget[]) => void;
  onReset: () => void;
}

const sizeOptions: { value: WidgetSize; label: string }[] = [
  { value: 'quarter', label: '1/4 Width' },
  { value: 'half', label: '1/2 Width' },
  { value: 'three-quarters', label: '3/4 Width' },
  { value: 'full', label: 'Full Width' }
];

export function WidgetManager({
  isOpen,
  onClose,
  widgets,
  onWidgetsChange,
  onReset
}: WidgetManagerProps) {
  const [localWidgets, setLocalWidgets] = useState<DashboardWidget[]>(widgets);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const activeWidgets = localWidgets.filter((w) => w.visible);
  const availableWidgets = localWidgets.filter((w) => !w.visible);

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const newWidgets = [...localWidgets];
    const activeIndices = newWidgets
      .map((w, i) => ({ w, i }))
      .filter(({ w }) => w.visible)
      .map(({ i }) => i);

    const draggedActiveIndex = activeIndices.indexOf(
      newWidgets.findIndex((w) => w.id === newWidgets[draggedIndex].id)
    );
    const targetActiveIndex = activeIndices.indexOf(
      newWidgets.findIndex((w) => w.id === newWidgets[index].id)
    );

    if (draggedActiveIndex === -1 || targetActiveIndex === -1) return;

    const [removed] = activeIndices.splice(draggedActiveIndex, 1);
    activeIndices.splice(targetActiveIndex, 0, removed);

    const reorderedWidgets = newWidgets.map((w) => ({ ...w }));
    activeIndices.forEach((originalIndex, newPosition) => {
      reorderedWidgets[originalIndex].position = newPosition;
    });

    setLocalWidgets(
      reorderedWidgets.sort((a, b) => {
        if (a.visible !== b.visible) return a.visible ? -1 : 1;
        return a.position - b.position;
      })
    );
    setDraggedIndex(index);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  const handleToggleVisibility = (widgetId: string) => {
    const newWidgets = localWidgets.map((w) =>
      w.id === widgetId ? { ...w, visible: !w.visible } : w
    );

    const visibleWidgets = newWidgets.filter((w) => w.visible);
    visibleWidgets.forEach((w, i) => {
      w.position = i;
    });

    setLocalWidgets(newWidgets);
  };

  const handleSizeChange = (widgetId: string, size: WidgetSize) => {
    setLocalWidgets(
      localWidgets.map((w) => (w.id === widgetId ? { ...w, size } : w))
    );
  };

  const handleSave = () => {
    const visible = localWidgets.filter((w) => w.visible);
    visible.forEach((w, i) => {
      w.position = i;
    });

    const sorted = [...localWidgets].sort((a, b) => {
      if (a.visible !== b.visible) return a.visible ? -1 : 1;
      return a.position - b.position;
    });

    onWidgetsChange(sorted);
    onClose();
  };

  const handleReset = () => {
    onReset();
    onClose();
  };

  const getIcon = (type: string) => {
    const Icon = widgetMetadata[type]?.icon;
    return Icon ? <Icon className="h-5 w-5" /> : null;
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>Customize Dashboard</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReset}
              className="text-muted-foreground"
            >
              <RotateCcw className="h-4 w-4 mr-1" />
              Reset
            </Button>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div>
            <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
              <Eye className="h-4 w-4" />
              Active Widgets ({activeWidgets.length})
              <span className="text-xs text-muted-foreground font-normal">
                - Drag to reorder
              </span>
            </h3>

            {activeWidgets.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No active widgets. Add some from below!
              </p>
            ) : (
              <div className="space-y-2">
                {activeWidgets.map((widget, index) => {
                  const globalIndex = localWidgets.findIndex(
                    (w) => w.id === widget.id
                  );
                  const meta = widgetMetadata[widget.type];

                  return (
                    <div
                      key={widget.id}
                      draggable
                      onDragStart={() => handleDragStart(globalIndex)}
                      onDragOver={(e) => handleDragOver(e, globalIndex)}
                      onDragEnd={handleDragEnd}
                      className={cn(
                        'flex items-center gap-3 p-3 bg-secondary/50 rounded-lg border transition-all',
                        draggedIndex === globalIndex &&
                          'opacity-50 ring-2 ring-primary'
                      )}
                    >
                      <div className="cursor-move">
                        <GripVertical className="h-5 w-5 text-muted-foreground" />
                      </div>

                      <div className="text-muted-foreground">
                        {getIcon(widget.type)}
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{meta?.title || widget.title}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {meta?.description}
                        </p>
                      </div>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8">
                            <Maximize2 className="h-3.5 w-3.5 mr-1" />
                            {sizeLabels[widget.size]}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {sizeOptions.map((option) => (
                            <DropdownMenuItem
                              key={option.value}
                              onClick={() =>
                                handleSizeChange(widget.id, option.value)
                              }
                              className={cn(
                                widget.size === option.value && 'bg-accent'
                              )}
                            >
                              {option.label}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>

                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleToggleVisibility(widget.id)}
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      >
                        <EyeOff className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
              <EyeOff className="h-4 w-4" />
              Available Widgets ({availableWidgets.length})
            </h3>

            {availableWidgets.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                All widgets are active!
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {availableWidgets.map((widget) => {
                  const meta = widgetMetadata[widget.type];

                  return (
                    <div
                      key={widget.id}
                      className="flex items-center gap-2 p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <div className="text-muted-foreground">
                        {getIcon(widget.type)}
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">
                          {meta?.title || widget.title}
                        </p>
                      </div>

                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleToggleVisibility(widget.id)}
                        className="h-7 w-7"
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save Changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
