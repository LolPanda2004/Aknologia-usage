// Calls the product notify.Show with a title containing quotes; prints the error instead of crashing.
package main

import (
	"fmt"
	"time"

	"github.com/aknologia/usage/agent/internal/notify"
)

func main() {
	t := time.Now()
	err := notify.Show(`QA it's "quoted" $env:USERNAME`, "body ' ; Write-Output pwned")
	fmt.Printf("err=%v took=%s\n", err, time.Since(t))
}
