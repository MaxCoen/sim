import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Combobox, type ComboboxOption } from '@/components/emcn/components'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/hooks/use-sub-block-value'
import { ResponseBlockHandler } from '@/executor/handlers/response/response-handler'

/**
 * Option type for the dropdown - can be a string or an object with label, id, and optional icon
 */
type DropdownOption =
  | string
  | { label: string; id: string; icon?: React.ComponentType<{ className?: string }> }

/**
 * Props for the Dropdown component
 */
interface DropdownProps {
  /** Available options for selection - can be static array or function that returns options */
  options: DropdownOption[] | (() => DropdownOption[])
  /** Default value to use when no value is set */
  defaultValue?: string
  /** ID of the parent block */
  blockId: string
  /** ID of the sub-block this dropdown belongs to */
  subBlockId: string
  /** Controlled value (overrides store value when provided) */
  value?: string
  /** Whether the component is in preview mode */
  isPreview?: boolean
  /** Value to display in preview mode */
  previewValue?: string | null
  /** Whether the dropdown is disabled */
  disabled?: boolean
  /** Placeholder text when no value is selected */
  placeholder?: string
  /** Configuration for the sub-block */
  config?: import('@/blocks/types').SubBlockConfig
}

/**
 * Dropdown component that provides a select-only interface for choosing from predefined options.
 * Uses the emcn Combobox component in select-only mode.
 *
 * Special handling for response block dataMode conversion between 'structured' and 'json' modes.
 *
 * @param props - Component props
 * @returns Rendered Dropdown component
 */
export function Dropdown({
  options,
  defaultValue,
  blockId,
  subBlockId,
  value: propValue,
  isPreview = false,
  previewValue,
  disabled,
  placeholder = 'Select an option...',
  config,
}: DropdownProps) {
  // Store management
  const [storeValue, setStoreValue] = useSubBlockValue<string>(blockId, subBlockId)
  const [storeInitialized, setStoreInitialized] = useState(false)
  const previousModeRef = useRef<string | null>(null)

  // For response dataMode conversion - get builderData and data sub-blocks
  const [builderData, setBuilderData] = useSubBlockValue<any[]>(blockId, 'builderData')
  const [data, setData] = useSubBlockValue<string>(blockId, 'data')

  // Keep refs with latest values to avoid stale closures
  const builderDataRef = useRef(builderData)
  const dataRef = useRef(data)

  useEffect(() => {
    builderDataRef.current = builderData
    dataRef.current = data
  }, [builderData, data])

  // Determine the active value based on mode (preview vs. controlled vs. store)
  const value = isPreview ? previewValue : propValue !== undefined ? propValue : storeValue

  // Evaluate options if provided as a function
  const evaluatedOptions = useMemo(() => {
    return typeof options === 'function' ? options() : options
  }, [options])

  /**
   * Extracts the value identifier from an option
   * @param option - The option to extract value from
   * @returns The option's value identifier
   */
  const getOptionValue = useCallback((option: DropdownOption): string => {
    return typeof option === 'string' ? option : option.id
  }, [])

  /**
   * Extracts the display label from an option
   * @param option - The option to extract label from
   * @returns The option's display label
   */
  const getOptionLabel = useCallback((option: DropdownOption): string => {
    return typeof option === 'string' ? option : option.label
  }, [])

  /**
   * Determines the default option value to use.
   * Priority: explicit defaultValue > first option
   */
  const defaultOptionValue = useMemo(() => {
    if (defaultValue !== undefined) {
      return defaultValue
    }

    if (evaluatedOptions.length > 0) {
      return getOptionValue(evaluatedOptions[0])
    }

    return undefined
  }, [defaultValue, evaluatedOptions, getOptionValue])

  // Convert options to Combobox format
  const comboboxOptions = useMemo((): ComboboxOption[] => {
    return evaluatedOptions.map((option) => {
      if (typeof option === 'string') {
        return { label: option, value: option }
      }
      return { label: option.label, value: option.id, icon: option.icon }
    })
  }, [evaluatedOptions])

  // Mark store as initialized on first render
  useEffect(() => {
    setStoreInitialized(true)
  }, [])

  // Set default value once store is initialized and value is undefined
  useEffect(() => {
    if (
      storeInitialized &&
      (value === null || value === undefined) &&
      defaultOptionValue !== undefined
    ) {
      setStoreValue(defaultOptionValue)
    }
  }, [storeInitialized, value, defaultOptionValue, setStoreValue])

  /**
   * Normalizes variable references in JSON strings
   * Replaces unquoted variable references with quoted ones
   * @param jsonString - JSON string to normalize
   * @returns Normalized JSON string
   */
  const normalizeVariableReferences = useCallback((jsonString: string): string => {
    // Replace unquoted variable references with quoted ones
    // Pattern: <variable.name> -> "<variable.name>"
    return jsonString.replace(/([^"]<[^>]+>)/g, '"$1"')
  }, [])

  /**
   * Infers field type from a value
   * @param value - Value to infer type from
   * @returns Inferred type
   */
  const inferType = useCallback(
    (value: any): 'string' | 'number' | 'boolean' | 'object' | 'array' => {
      if (typeof value === 'boolean') return 'boolean'
      if (typeof value === 'number') return 'number'
      if (Array.isArray(value)) return 'array'
      if (typeof value === 'object' && value !== null) return 'object'
      return 'string'
    },
    []
  )

  /**
   * Converts JSON string to builder data format
   * @param jsonString - JSON string to convert
   * @returns Builder data array
   */
  const convertJsonToBuilderData = useCallback(
    (jsonString: string): any[] => {
      try {
        // Always normalize variable references first
        const normalizedJson = normalizeVariableReferences(jsonString)
        const parsed = JSON.parse(normalizedJson)

        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          return Object.entries(parsed).map(([key, value]) => {
            const fieldType = inferType(value)
            const fieldValue =
              fieldType === 'object' || fieldType === 'array'
                ? JSON.stringify(value, null, 2)
                : value

            return {
              id: crypto.randomUUID(),
              name: key,
              type: fieldType,
              value: fieldValue,
              collapsed: false,
            }
          })
        }

        return []
      } catch (error) {
        return []
      }
    },
    [normalizeVariableReferences, inferType]
  )

  /**
   * Handles data conversion when dataMode changes between 'structured' and 'json'
   */
  useEffect(() => {
    if (subBlockId !== 'dataMode' || isPreview || disabled) return

    const currentMode = storeValue
    const previousMode = previousModeRef.current

    // Only convert if the mode actually changed
    if (previousMode !== null && previousMode !== currentMode) {
      // Builder to Editor mode (structured → json)
      if (currentMode === 'json' && previousMode === 'structured') {
        const currentBuilderData = builderDataRef.current
        if (
          currentBuilderData &&
          Array.isArray(currentBuilderData) &&
          currentBuilderData.length > 0
        ) {
          const jsonString = ResponseBlockHandler.convertBuilderDataToJsonString(currentBuilderData)
          setData(jsonString)
        }
      }
      // Editor to Builder mode (json → structured)
      else if (currentMode === 'structured' && previousMode === 'json') {
        const currentData = dataRef.current
        if (currentData && typeof currentData === 'string' && currentData.trim().length > 0) {
          const builderArray = convertJsonToBuilderData(currentData)
          setBuilderData(builderArray)
        }
      }
    }

    // Update the previous mode ref
    previousModeRef.current = currentMode
  }, [
    storeValue,
    subBlockId,
    isPreview,
    disabled,
    setData,
    setBuilderData,
    convertJsonToBuilderData,
  ])

  /**
   * Handles value change from Combobox
   * @param newValue - The selected value
   */
  const handleChange = useCallback(
    (newValue: string) => {
      if (!isPreview && !disabled) {
        setStoreValue(newValue)
      }
    },
    [isPreview, disabled, setStoreValue]
  )

  const displayValue = useMemo(() => value?.toString() ?? '', [value])

  return (
    <div className='relative w-full'>
      <Combobox
        options={comboboxOptions}
        value={displayValue}
        onChange={handleChange}
        placeholder={placeholder}
        disabled={disabled}
        editable={false}
      />
    </div>
  )
}
