import * as React from "react";
import { format } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface DatePickerProps {
  date: Date | undefined;
  setDate: (date: Date | undefined) => void;
  fromYear?: number;
  toYear?: number;
  placeholder?: string;
  className?: string;
}

export function DatePicker({
  date,
  setDate,
  fromYear = 1950,
  toYear = new Date().getFullYear(),
  placeholder = 'Pick a date',
  className
}: DatePickerProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          type="button"
          className={cn(
            "w-full justify-start text-left font-normal",
            !date && "text-muted-foreground",
            className
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {date ? format(date, "PPP") : <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-auto p-2">
        <Calendar
          mode="single"
          selected={date}
          onSelect={(d) => setDate(d)}
          initialFocus
          captionLayout="dropdown"
          fromYear={fromYear}
          toYear={toYear}
        />
      </PopoverContent>
    </Popover>
  );
}