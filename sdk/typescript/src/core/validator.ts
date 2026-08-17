/**
 * Schema Validation — ajv JSON Schemas
 * Reference: spec/003-capabilities.mdspec/005-errors.md (SCHEMA_VALIDATION_FAILED)
  */

import Ajv, { type ValidateFunction } from "ajv/dist/2019.js";
import addFormats from "ajv-formats";

const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });
addFormats(ajv);

const compiledCache = new WeakMap<object, ValidateFunction>();

export interface ValidationResult {
  valid: boolean;
  errors: Array<{
    path: string;
    message: string;
  }>;
}

export function validate(instance: unknown, schema: object): ValidationResult {
  let validator = compiledCache.get(schema);
  if (!validator) {
    try {
      validator = ajv.compile(schema);
    } catch (err) {
      return {
        valid: false,
        errors: [
          {
            path: "$",
            message: `Schema compile error: ${(err as Error).message}`,
          },
        ],
      };
    }
    compiledCache.set(schema, validator);
  }

  const valid = validator(instance) as boolean;
  if (valid) return { valid: true, errors: [] };

  return {
    valid: false,
    errors: (validator.errors || []).map((e) => ({
      path: e.instancePath || "$",
      message: e.message || "validation failed",
    })),
  };
}

/**
 * Validate input against capability input schema.
  */
export function validateCapabilityInput(
  input: unknown,
  capability: { input: { schema: object } }
): ValidationResult {
  return validate(input, capability.input.schema);
}

/**
 * Validate output against capability output schema.
  */
export function validateCapabilityOutput(
  output: unknown,
  capability: { output: { schema: object } }
): ValidationResult {
  return validate(output, capability.output.schema);
}

/**
 * Compile a schema into a reusable function (for performance).
  */
export function compileSchema(schema: object): (data: unknown) => boolean {
  const validator = ajv.compile(schema);
  return (data: unknown) => validator(data) as boolean;
}
