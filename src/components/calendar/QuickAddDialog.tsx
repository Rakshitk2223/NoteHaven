import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { dateToYMD } from "@/lib/date-utils";
import { CheckSquare, Cake, Loader2 } from "lucide-react";

interface QuickAddDialogProps {
  date: Date | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export const QuickAddDialog = ({ date, open, onOpenChange, onSuccess }: QuickAddDialogProps) => {
  const { toast } = useToast();
  const [taskText, setTaskText] = useState('');
  const [birthdayName, setBirthdayName] = useState('');
  const [birthdayYear, setBirthdayYear] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('task');

  const handleAddTask = async () => {
    if (!taskText.trim() || !date) return;

    setIsLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase.from('tasks').insert([{
        user_id: user.id,
        task_text: taskText.trim(),
        due_date: dateToYMD(date),
        is_completed: false,
      }]);

      if (error) throw error;

      toast({
        title: 'Task added',
        description: `Task added for ${date.toLocaleDateString()}`,
      });

      setTaskText('');
      onOpenChange(false);
      onSuccess();
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to add task',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddBirthday = async () => {
    if (!birthdayName.trim() || !date) return;

    setIsLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Construct date string - use year if provided, otherwise use current year
      const year = birthdayYear ? parseInt(birthdayYear) : new Date().getFullYear();
      const month = date.getMonth() + 1;
      const day = date.getDate();
      const dateString = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

      const { error } = await supabase.from('birthdays').insert([{
        user_id: user.id,
        name: birthdayName.trim(),
        date_of_birth: dateString,
      }]);

      if (error) throw error;

      toast({
        title: 'Birthday added',
        description: `${birthdayName}'s birthday added`,
      });

      setBirthdayName('');
      setBirthdayYear('');
      onOpenChange(false);
      onSuccess();
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to add birthday',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const formattedDate = date?.toLocaleDateString('en-IN', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Add Event for {formattedDate}</DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="task" className="flex items-center gap-2">
              <CheckSquare className="h-4 w-4" />
              Task
            </TabsTrigger>
            <TabsTrigger value="birthday" className="flex items-center gap-2">
              <Cake className="h-4 w-4" />
              Birthday
            </TabsTrigger>
          </TabsList>

          <TabsContent value="task" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="task-text">Task Description</Label>
              <Input
                id="task-text"
                placeholder="What needs to be done?"
                value={taskText}
                onChange={(e) => setTaskText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !isLoading) {
                    handleAddTask();
                  }
                }}
              />
            </div>
            <Button
              onClick={handleAddTask}
              disabled={!taskText.trim() || isLoading}
              className="w-full"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Adding...
                </>
              ) : (
                'Add Task'
              )}
            </Button>
          </TabsContent>

          <TabsContent value="birthday" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="birthday-name">Person's Name</Label>
              <Input
                id="birthday-name"
                placeholder="Who's birthday is it?"
                value={birthdayName}
                onChange={(e) => setBirthdayName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="birthday-year">Birth Year (Optional)</Label>
              <Input
                id="birthday-year"
                type="number"
                placeholder="e.g., 1990"
                value={birthdayYear}
                onChange={(e) => setBirthdayYear(e.target.value)}
                min="1900"
                max={new Date().getFullYear()}
              />
              <p className="text-xs text-muted-foreground">
                Leave blank if you don't know the year
              </p>
            </div>
            <Button
              onClick={handleAddBirthday}
              disabled={!birthdayName.trim() || isLoading}
              className="w-full"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Adding...
                </>
              ) : (
                'Add Birthday'
              )}
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
