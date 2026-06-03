import { useState } from 'react';
import { Plus, X, Settings2, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { cn } from '@/lib/utils';

// Available media types for custom groups
const AVAILABLE_TYPES = [
  'Manga',
  'Manhwa',
  'Manhua',
  'Anime',
  'Series',
  'Movie',
  'KDrama',
  'JDrama',
] as const;

export interface CustomGroup {
  id: string;
  name: string;
  types: string[];
}

// A single category selection: 'all', a single type ('type:Anime'), or a custom group id.
export type ActiveCategory = string;

export const TYPE_PREFIX = 'type:';
export const isTypeCategory = (cat: string) => cat.startsWith(TYPE_PREFIX);
export const typeOf = (cat: string) => cat.slice(TYPE_PREFIX.length);

interface CustomGroupBuilderProps {
  groups: CustomGroup[];
  onGroupsChange: (groups: CustomGroup[]) => void;
  activeCategory: ActiveCategory;
  onActiveCategoryChange: (cat: ActiveCategory) => void;
  itemCounts: Record<string, number>;
  /** Single-type quick pills to display, in order. */
  typePills: string[];
  /** Opens the parent-managed "manage type pills" dialog. */
  onManageTypes: () => void;
}

const pillBase =
  'flex items-center gap-2 px-4 py-2 rounded-full whitespace-nowrap transition-all duration-200 font-medium text-sm border-2';

const COUNT_TOOLTIP = "Total items of this category's types (not affected by status/search filters)";

export const CustomGroupBuilder = ({
  groups,
  onGroupsChange,
  activeCategory,
  onActiveCategoryChange,
  itemCounts,
  typePills,
  onManageTypes,
}: CustomGroupBuilderProps) => {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<CustomGroup | null>(null);
  const [groupName, setGroupName] = useState('');
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<CustomGroup | null>(null);

  const maxGroups = 4;
  const canAddMore = groups.length < maxGroups;

  const handleAddGroup = () => {
    setEditingGroup(null);
    setGroupName('');
    setSelectedTypes([]);
    setIsDialogOpen(true);
  };

  const handleEditGroup = (group: CustomGroup) => {
    setEditingGroup(group);
    setGroupName(group.name);
    setSelectedTypes(group.types);
    setIsDialogOpen(true);
  };

  const handleDeleteGroup = (groupId: string) => {
    const newGroups = groups.filter((g) => g.id !== groupId);
    onGroupsChange(newGroups);
    if (activeCategory === groupId) {
      onActiveCategoryChange('all');
    }
  };

  const confirmDeleteGroup = () => {
    if (!deleteTarget) return;
    handleDeleteGroup(deleteTarget.id);
    setDeleteTarget(null);
  };

  const handleSaveGroup = () => {
    if (!groupName.trim() || selectedTypes.length === 0) return;

    if (editingGroup) {
      const updatedGroups = groups.map((g) =>
        g.id === editingGroup.id ? { ...g, name: groupName.trim(), types: selectedTypes } : g
      );
      onGroupsChange(updatedGroups);
    } else {
      const newGroup: CustomGroup = {
        id: `group_${Date.now()}`,
        name: groupName.trim(),
        types: selectedTypes,
      };
      onGroupsChange([...groups, newGroup]);
    }

    setIsDialogOpen(false);
    setGroupName('');
    setSelectedTypes([]);
    setEditingGroup(null);
  };

  const toggleType = (type: string) => {
    setSelectedTypes((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]));
  };

  const renderCount = (key: string, active: boolean) =>
    itemCounts[key] > 0 ? (
      <span
        className={cn('text-xs px-2 py-0.5 rounded-full', active ? 'bg-primary-foreground/20' : 'bg-muted')}
        title={COUNT_TOOLTIP}
      >
        {itemCounts[key]}
      </span>
    ) : null;

  const activeClasses = 'bg-primary text-primary-foreground border-primary shadow-md';
  const inactiveClasses =
    'bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground';

  return (
    <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide items-center">
      {/* All */}
      <button
        onClick={() => onActiveCategoryChange('all')}
        className={cn(pillBase, activeCategory === 'all' ? activeClasses : inactiveClasses)}
      >
        <span>All</span>
        {renderCount('all', activeCategory === 'all')}
      </button>

      {/* Single-type quick pills */}
      {typePills.map((t) => {
        const cat = `${TYPE_PREFIX}${t}`;
        const active = activeCategory === cat;
        return (
          <button
            key={cat}
            onClick={() => onActiveCategoryChange(cat)}
            className={cn(pillBase, active ? activeClasses : inactiveClasses)}
          >
            <span>{t}</span>
            {renderCount(cat, active)}
          </button>
        );
      })}

      {/* Custom Groups */}
      {groups.map((group) => {
        const active = activeCategory === group.id;
        return (
          <div key={group.id} className="relative group">
            <button
              onClick={() => onActiveCategoryChange(group.id)}
              className={cn(pillBase, active ? activeClasses : inactiveClasses)}
            >
              <span>{group.name}</span>
              {renderCount(group.id, active)}
            </button>

            {/* Edit/Delete buttons on hover */}
            <div className="absolute -top-2 -right-2 hidden group-hover:flex gap-1">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleEditGroup(group);
                }}
                className="w-5 h-5 rounded-full bg-secondary flex items-center justify-center hover:bg-primary hover:text-primary-foreground"
                aria-label={`Edit group ${group.name}`}
                title={`Edit group ${group.name}`}
              >
                <Settings2 className="w-3 h-3" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteTarget(group);
                }}
                className="w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center hover:bg-destructive/90"
                aria-label={`Delete group ${group.name}`}
                title={`Delete group ${group.name}`}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>
        );
      })}

      {/* Add Group */}
      {canAddMore && (
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <button
              onClick={handleAddGroup}
              className={cn(
                pillBase,
                'bg-background text-muted-foreground border-dashed border-border hover:border-primary hover:text-primary'
              )}
              aria-label="Add custom group"
            >
              <Plus className="h-4 w-4" />
              <span>Group</span>
            </button>
          </DialogTrigger>

          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{editingGroup ? 'Edit Group' : 'Create New Group'}</DialogTitle>
              <DialogDescription>Group media types together into a custom category pill.</DialogDescription>
            </DialogHeader>

            <div className="space-y-6 py-4">
              <div className="space-y-2">
                <Label htmlFor="group-name">Group Name</Label>
                <Input
                  id="group-name"
                  placeholder="e.g., My Favorites"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  maxLength={20}
                />
                <p className="text-xs text-muted-foreground">{groupName.length}/20 characters</p>
              </div>

              <div className="space-y-3">
                <Label>Select Types</Label>
                <div className="grid grid-cols-2 gap-2">
                  {AVAILABLE_TYPES.map((type) => (
                    <div key={type} className="flex items-center space-x-2">
                      <Checkbox
                        id={`type-${type}`}
                        checked={selectedTypes.includes(type)}
                        onCheckedChange={() => toggleType(type)}
                      />
                      <label htmlFor={`type-${type}`} className="text-sm font-medium leading-none cursor-pointer">
                        {type}
                      </label>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setIsDialogOpen(false);
                    setGroupName('');
                    setSelectedTypes([]);
                    setEditingGroup(null);
                  }}
                >
                  Cancel
                </Button>
                <Button onClick={handleSaveGroup} disabled={!groupName.trim() || selectedTypes.length === 0}>
                  {editingGroup ? 'Save Changes' : 'Create Group'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Manage which type pills are visible */}
      <Button
        variant="ghost"
        size="icon"
        className="flex-shrink-0 rounded-full h-9 w-9 text-muted-foreground"
        onClick={onManageTypes}
        aria-label="Manage type pills"
        title="Manage type pills"
      >
        <SlidersHorizontal className="h-4 w-4" />
      </Button>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        onConfirm={confirmDeleteGroup}
        title="Delete Group"
        description={
          deleteTarget
            ? `Delete the group "${deleteTarget.name}"? This only removes the group, not your media items.`
            : ''
        }
      />
    </div>
  );
};

// Helper function to check if item belongs to a custom group
export function itemBelongsToCustomGroup(itemType: string, group: CustomGroup): boolean {
  return group.types.includes(itemType);
}
