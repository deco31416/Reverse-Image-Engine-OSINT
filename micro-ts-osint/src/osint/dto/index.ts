export * from './create-search.dto';
export * from './update-search.dto';
export * from './search-query.dto';
export * from './person-search.dto';

// Phase 2: Multi-Modal Input DTOs
// Export with aliases to avoid conflicts with person-search.dto
export { ImageInputDto } from './image-input.dto';
export { PersonalInfoDto } from './personal-info.dto';
export { ContextDto } from './context.dto';
export { SearchOptionsDto, CrawlStrategy } from './search-options.dto';
export {
  ExpandedPersonSearchDto,
  OsintSearchResponseDto,
} from './expanded-person-search.dto';

// Re-export enums from new DTOs with explicit names
export { ImageSource as ImageSourceV2 } from './image-input.dto';
export { SearchEngine as SearchEngineV2 } from './search-options.dto';
