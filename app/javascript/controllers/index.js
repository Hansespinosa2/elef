// Register controllers from the importmap via controllers/**/*_controller.
// A controller module is fetched the first time a matching data-controller
// appears in the DOM, so a page only parses the controllers it actually mounts.
import { application } from "controllers/application"
import { lazyLoadControllersFrom } from "@hotwired/stimulus-loading"
lazyLoadControllersFrom("controllers", application)
