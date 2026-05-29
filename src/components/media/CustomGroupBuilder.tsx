import { useState } from 'react';
import { Plus, X, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
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

interface CustomGroupBuilderProps {
  groups: CustomGroup[];
  onGroupsChange: (groups: CustomGroup[]) => void;
  activeGroupId: string | 'all';
  onActiveGroupChange: (groupId: string | 'all') => void;
  itemCounts: Record<string, number>;
}

export const CustomGroupBuilder = ({
  groups,
  onGroupsChange,
  activeGroupId,
  onActiveGroupChange,
  itemCounts,
}: CustomGroupBuilderProps) => {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<CustomGroup | null>(null);
  const [groupName, setGroupName] = useState('');
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);

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
    const newGroups = groups.filter(g => g.id !== groupId);
    onGroupsChange(newGroups);
    if (activeGroupId === groupId) {
      onActiveGroupChange('all');
    }
  };

  const handleSaveGroup = () => {
    if (!groupName.trim() || selectedTypes.length === 0) return;

    if (editingGroup) {
      // Update existing group
      const updatedGroups = groups.map(g =>
        g.id === editingGroup.id
          ? { ...g, name: groupName.trim(), types: selectedTypes }
          : g
      );
      onGroupsChange(updatedGroups);
    } else {
      // Add new group
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
    setSelectedTypes(prev =>
      prev.includes(type)
        ? prev.filter(t => t !== type)
        : [...prev, type]
    );
  };

  return (
    <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide items-center">
      {/* All Items Tab */}
      <button
        onClick={() => onActiveGroupChange('all')}
        className={cn(
          "flex items-center gap-2 px-4 py-2 rounded-full whitespace-nowrap",
          "transition-all duration-200 font-medium text-sm border-2",
          activeGroupId === 'all'
            ? "bg-primary text-primary-foreground border-primary shadow-md"
            : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
        )}
      >
        <span>All</span>
        {itemCounts['all'] > 0 && (
          <span className={cn(
            "text-xs px-2 py-0.5 rounded-full",
            activeGroupId === 'all' ? "bg-primary-foreground/20" : "bg-muted"
          )}>
            {itemCounts['all']}
          </span>
        )}
      </button>

      {/* Custom Groups */}
      {groups.map((group) => (
        <div key={group.id} className="relative group">
          <button
            onClick={() => onActiveGroupChange(group.id)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-full whitespace-nowrap",
              "transition-all duration-200 font-medium text-sm border-2",
              activeGroupId === group.id
                ? "bg-primary text-primary-foreground border-primary shadow-md"
                : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
            )}
          >
            <span>{group.name}</span>
            {itemCounts[group.id] > 0 && (
              <span className={cn(
                "text-xs px-2 py-0.5 rounded-full",
                activeGroupId === group.id ? "bg-primary-foreground/20" : "bg-muted"
              )}>
                {itemCounts[group.id]}
              </span>
            )}
          </button>
          
          {/* Edit/Delete buttons on hover */}
          <div className="absolute -top-2 -right-2 hidden group-hover:flex gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleEditGroup(group);
              }}
              className="w-5 h-5 rounded-full bg-secondary flex items-center justify-center hover:bg-primary hover:text-primary-foreground"
            >
              <Settings2 className="w-3 h-3" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteGroup(group.id);
              }}
              className="w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center hover:bg-destructive/90"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
      ))}

      {/* Add Group Button */}
      {canAddMore && (
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <button
              onClick={handleAddGroup}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-full whitespace-nowrap",
                "transition-all duration-200 font-medium text-sm border-2",
                "bg-background text-muted-foreground border-dashed border-border",
                "hover:border-primary hover:text-primary"
              )}
            >
              <Plus className="h-4 w-4" />
              <span>Add Group</span>
            </button>
          </DialogTrigger>
          
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>
                {editingGroup ? 'Edit Group' : 'Create New Group'}
              </DialogTitle>
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
                <p className="text-xs text-muted-foreground">
                  {groupName.length}/20 characters
                </p>
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
                      <label
                        htmlFor={`type-${type}`}
                        className="text-sm font-medium leading-none cursor-pointer"
                      >
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
                <Button
                  onClick={handleSaveGroup}
                  disabled={!groupName.trim() || selectedTypes.length === 0}
                >
                  {editingGroup ? 'Save Changes' : 'Create Group'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};

// Helper function to check if item belongs to a custom group
export function itemBelongsToCustomGroup(itemType: string, group: CustomGroup): boolean {
  return group.types.includes(itemType);
}
