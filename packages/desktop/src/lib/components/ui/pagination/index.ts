import Root from "./pagination.svelte";
import Content from "./pagination-content.svelte";
import Ellipsis from "./pagination-ellipsis.svelte";
import Item from "./pagination-item.svelte";
import Link from "./pagination-link.svelte";
import Next from "./pagination-next.svelte";
import NextButton from "./pagination-next-button.svelte";
import PrevButton from "./pagination-prev-button.svelte";
import Previous from "./pagination-previous.svelte";

export {
	Content as PaginationContent,
	Content,
	Ellipsis as PaginationEllipsis,
	Ellipsis,
	Item as PaginationItem,
	Item,
	Link as PaginationLink,
	Link,
	Next as PaginationNext,
	Next,
	NextButton as PaginationNextButton, //old
	NextButton, //old
	PrevButton as PaginationPrevButton, //old
	PrevButton, //old
	Previous as PaginationPrevious,
	Previous,
	//
	Root as Pagination,
	Root,
};
