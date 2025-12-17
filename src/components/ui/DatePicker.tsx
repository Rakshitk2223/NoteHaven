import * as React from "react";
import { format, addDays, addWeeks, startOfWeek, addMonths } from "date-fns";
import { Calendar as CalendarIcon, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface DatePickerProps {
  date: Date | undefined;
  setDate: (date: Date | undefined) => void;
  fromYear?: number;
  toYear?: number;
  placeholder?: string;
  className?: string;
  showClear?: boolean;
}

export function DatePicker({
  date,
  setDate,
  placeholder = 'Set date',
  className,
  showClear = true
}: DatePickerProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [viewDate, setViewDate] = React.useState(date || new Date());
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const quickOptions = [
    { label: 'Today', date: today },
    { label: 'Tomorrow', date: addDays(today, 1) },
    { label: 'In 3 days', date: addDays(today, 3) },
    { label: 'Next week', date: addWeeks(today, 1) },
    { label: 'In 2 weeks', date: addWeeks(today, 2) },
    { label: 'Next month', date: addMonths(today, 1) },
  ];
  
  const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate();
  const firstDayOfMonth = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1).getDay();
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const blanks = Array.from({ length: firstDayOfMonth }, (_, i) => i);
  
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  
  const handleDateSelect = (day: number) => {
    const selected = new Date(viewDate.getFullYear(), viewDate.getMonth(), day);
    setDate(selected);
    setIsOpen(false);
  };
  
  const handleQuickSelect = (selectedDate: Date) => {
    setDate(selectedDate);
    setIsOpen(false);
  };
  
  const isSelected = (day: number) => {
    if (!date) return false;
    return date.getDate() === day && 
           date.getMonth() === viewDate.getMonth() && 
           date.getFullYear() === viewDate.getFullYear();
  };
  
  const isToday = (day: number) => {
    return today.getDate() === day && 
           today.getMonth() === viewDate.getMonth() && 
           today.getFullYear() === viewDate.getFullYear();
  };
  
  const prevMonth = () => {
    setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1));
  };
  
  const nextMonth = () => {
    setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1));
  };
  
  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <div className="relative flex items-center gap-1">
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            type="button"
            className={cn(
              "w-full justify-start text-left font-normal h-10 px-3",
              !date && "text-muted-foreground",
              className
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4 flex-shrink-0" />
            <span className="truncate">
              {date ? format(date, "MMM d, yyyy") : placeholder}
            </span>
          </Button>
        </PopoverTrigger>
        {showClear && date && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-10 w-10 flex-shrink-0"
            onClick={(e) => {
              e.preventDefault();
              setDate(undefined);
            }}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="p-3 space-y-3">
          {/* Quick Select Options */}
          <div className="grid grid-cols-2 gap-2">
            {quickOptions.map((option) => (
              <Button
                key={option.label}
                type="button"
                variant="outline"
                size="sm"
                className="text-xs h-8"
                onClick={() => handleQuickSelect(option.date)}
              >
                {option.label}
              </Button>
            ))}
          </div>
          
          <div className="border-t pt-3">
            {/* Month/Year Navigation */}
            <div className="flex items-center justify-between mb-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={prevMonth}
                className="h-8 w-8 p-0"
              >
                ←
              </Button>
              <div className="font-semibold text-sm">
                {monthNames[viewDate.getMonth()]} {viewDate.getFullYear()}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={nextMonth}
                className="h-8 w-8 p-0"
              >
                →
              </Button>
            </div>
            
            {/* Calendar Grid */}
            <div className="grid grid-cols-7 gap-1">
              {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day) => (
                <div key={day} className="text-center text-xs font-medium text-muted-foreground h-8 flex items-center justify-center">
                  {day}
                </div>
              ))}
              {blanks.map((i) => (
                <div key={`blank-${i}`} className="h-8" />
              ))}
              {days.map((day) => (
                <Button
                  key={day}
                  type="button"
                  variant={isSelected(day) ? "default" : "ghost"}
                  size="sm"
                  className={cn(
                    "h-8 w-8 p-0 font-normal text-sm",
                    isToday(day) && !isSelected(day) && "border border-primary",
                    isSelected(day) && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
                  )}
                  onClick={() => handleDateSelect(day)}
                >
                  {day}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}