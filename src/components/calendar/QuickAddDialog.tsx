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
import { CheckSquare, Cake, Clock, Loader2 } from "lucide-react";

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
  const [countdownName, setCountdownName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('task');

  const handleAddTask = async () => {
    if (!taskText.trim() || !date) return;

    setIsLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
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

  const handleAddCountdown = async () => {
    if (!countdownName.trim() || !date) return;

    setIsLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase.from('countdowns').insert([{
        user_id: user.id,
        event_name: countdownName.trim(),
        event_date: dateToYMD(date),
      }]);
      if (error) throw error;

      toast({ title: 'Countdown added', description: `Counting down to ${date.toLocaleDateString()}` });
      setCountdownName('');
      onOpenChange(false);
      onSuccess();
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to add countdown',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const validateBirthdayYear = (year: string): number | null => {
    if (!year.trim()) return new Date().getFullYear();
    
    const yearNum = parseInt(year, 10);
    const currentYear = new Date().getFullYear();
    
    if (isNaN(yearNum) || yearNum < 1900 || yearNum > currentYear) {
      return null;
    }
    
    return yearNum;
  };

  const handleAddBirthday = async () => {
    if (!birthdayName.trim() || !date) return;

    // Validate year before proceeding
    const validatedYear = validateBirthdayYear(birthdayYear);
    if (validatedYear === null) {
      toast({
        title: 'Invalid year',
        description: `Please enter a valid year between 1900 and ${new Date().getFullYear()}`,
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error('Not authenticated');

      const month = date.getMonth() + 1;
      const day = date.getDate();
      const dateString = `${validatedYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

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

  // Clear the form on close — reopening for a different day used to show the
  // text you'd abandoned on the previous one.
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setTaskText('');
      setBirthdayName('');
      setBirthdayYear('');
      setCountdownName('');
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Add Event for {formattedDate}</DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="task" className="flex items-center gap-2">
              <CheckSquare className="h-4 w-4" />
              Task
            </TabsTrigger>
            <TabsTrigger value="birthday" className="flex items-center gap-2">
              <Cake className="h-4 w-4" />
              Birthday
            </TabsTrigger>
            <TabsTrigger value="countdown" className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Countdown
            </TabsTrigger>
          </TabsList>

          <TabsContent value="countdown" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="countdown-name">Event Name</Label>
              <Input
                id="countdown-name"
                placeholder="e.g., Launch Day"
                value={countdownName}
                maxLength={100}
                onChange={(e) => setCountdownName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !isLoading && countdownName.trim()) {
                    handleAddCountdown();
                  }
                }}
              />
            </div>
            <Button
              onClick={handleAddCountdown}
              disabled={!countdownName.trim() || isLoading}
              className="w-full"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Adding...
                </>
              ) : (
                'Add Countdown'
              )}
            </Button>
          </TabsContent>

          <TabsContent value="task" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="task-text">Task Description</Label>
              <Input
                id="task-text"
                placeholder="What needs to be done?"
                value={taskText}
                maxLength={500}
                onChange={(e) => setTaskText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !isLoading && taskText.trim()) {
                    handleAddTask();
                  }
                }}
              />
              <p className="text-xs text-muted-foreground text-right">
                {taskText.length}/500
              </p>
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
                placeholder="Whose birthday is it?"
                value={birthdayName}
                maxLength={100}
                onChange={(e) => setBirthdayName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !isLoading && birthdayName.trim()) {
                    handleAddBirthday();
                  }
                }}
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
