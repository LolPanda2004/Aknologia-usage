// Command aknologia-usage is the desktop window. It is a thin Wails shell: all tracking happens in the
// background agent (aknologia-agent), which this window starts if it isn't already running.
package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()
	err := wails.Run(&options.App{
		Title:            "Aknologia Usage",
		Width:            1320,
		Height:           880,
		MinWidth:         960,
		MinHeight:        640,
		BackgroundColour: &options.RGBA{R: 8, G: 18, B: 15, A: 255},
		AssetServer:      &assetserver.Options{Assets: assets},
		OnStartup:        app.startup,
		Bind:             []interface{}{app},
	})
	if err != nil {
		log.Fatal(err)
	}
}
