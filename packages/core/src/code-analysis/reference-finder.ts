/**
 * Reference information for a symbol usage
 */
export interface SymbolReference {
  filePath: string;
  line: number;
  column: number;
  /** The line of code containing the reference */
  lineText: string;
  /** Type of reference */
  referenceType: 'usage' | 'import' | 'call' | 'property_access' | 'type_reference';
}
