"use client";

import { useState, useRef, useEffect, useCallback, useId } from "react";

export interface AddressDetails {
  address: string;
  lat: number;
  lng: number;
}

interface AddressAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onSelectDetails?: (details: AddressDetails) => void;
  placeholder?: string;
  id?: string;
  className?: string;
  disabled?: boolean;
}

interface Prediction {
  place_id: string;
  description: string;
}

const DEBOUNCE_MS = 300;

export function AddressAutocomplete({
  value,
  onChange,
  onSelectDetails,
  placeholder = "Start typing address...",
  id,
  className = "",
  disabled = false,
}: AddressAutocompleteProps) {
  const [inputValue, setInputValue] = useState(value);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const fetchPredictions = useCallback(async (input: string) => {
    if (!input.trim()) {
      setPredictions([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/places/autocomplete?input=${encodeURIComponent(input)}`
      );
      const data = await res.json();
      if (data.error) {
        setPredictions([]);
        return;
      }
      setPredictions(data.predictions ?? []);
      setActiveIndex(-1);
      setShowDropdown(true);
    } catch {
      setPredictions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setInputValue(v);
    onChange(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchPredictions(v);
    }, DEBOUNCE_MS);
  }

  async function handleSelect(p: Prediction) {
    setPredictions([]);
    setShowDropdown(false);
    if (onSelectDetails) {
      try {
        const res = await fetch(
          `/api/places/details?place_id=${encodeURIComponent(p.place_id)}`
        );
        const data = await res.json();
        if (data.address && typeof data.lat === "number" && typeof data.lng === "number") {
          const addr = data.address;
          setInputValue(addr);
          onChange(addr);
          onSelectDetails({
            address: addr,
            lat: data.lat,
            lng: data.lng,
          });
        } else {
          setInputValue(p.description);
          onChange(p.description);
        }
      } catch {
        setInputValue(p.description);
        onChange(p.description);
      }
    } else {
      setInputValue(p.description);
      onChange(p.description);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!showDropdown || predictions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i < predictions.length - 1 ? i + 1 : 0));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i > 0 ? i - 1 : predictions.length - 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < predictions.length) {
        handleSelect(predictions[activeIndex]);
      }
      return;
    }
    if (e.key === "Escape") {
      setShowDropdown(false);
      setActiveIndex(-1);
    }
  }

  return (
    <div ref={wrapperRef} className="relative">
      <input
        type="text"
        id={id}
        value={inputValue}
        onChange={handleInputChange}
        onFocus={() => {
          if (predictions.length > 0) setShowDropdown(true);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={className}
        disabled={disabled}
        autoComplete="off"
        role="combobox"
        aria-expanded={showDropdown}
        aria-controls={listboxId}
        aria-autocomplete="list"
      />
      {showDropdown && predictions.length > 0 && (
        <ul
          id={listboxId}
          className="absolute z-50 mt-1 w-full max-h-60 overflow-auto border border-gray-200 rounded-md bg-white shadow-lg py-1"
          role="listbox"
        >
          {predictions.map((p, i) => (
            <li
              key={p.place_id}
              role="option"
              aria-selected={i === activeIndex}
              className={`px-3 py-2 cursor-pointer text-sm ${
                i === activeIndex ? "bg-blue-50" : "hover:bg-gray-50"
              }`}
              onMouseEnter={() => setActiveIndex(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelect(p);
              }}
            >
              {p.description}
            </li>
          ))}
        </ul>
      )}
      {loading && (
        <span
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs"
          aria-hidden
        >
          …
        </span>
      )}
    </div>
  );
}
